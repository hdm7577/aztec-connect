import { MemoryFifo } from 'barretenberg/fifo';
import { InnerProofData, RollupProofData } from 'barretenberg/rollup_proof';
import { WorldStateDb } from 'barretenberg/world_state_db';
import { toBigIntBE, toBufferBE } from 'bigint-buffer';
import { Blockchain } from 'barretenberg/blockchain';
import { RollupDao } from './entity/rollup';
import { RollupProofDao } from './entity/rollup_proof';
import { TxDao } from './entity/tx';
import { Metrics } from './metrics';
import { RollupDb } from './rollup_db';
import { Block } from 'barretenberg/block_source';
import { ViewingKey } from 'barretenberg/viewing_key';
import { RollupPipeline, RollupPipelineFactory } from './rollup_pipeline';

const innerProofDataToTxDao = (tx: InnerProofData, viewingKeys: ViewingKey[], created: Date) => {
  const txDao = new TxDao();
  txDao.id = tx.txId;
  txDao.proofData = tx.toBuffer();
  txDao.viewingKey1 = viewingKeys[0];
  txDao.viewingKey2 = viewingKeys[1];
  txDao.nullifier1 = tx.nullifier1;
  txDao.nullifier2 = tx.nullifier2;
  txDao.created = created;
  return txDao;
};

export class WorldState {
  private blockQueue = new MemoryFifo<Block>();
  private pipeline!: RollupPipeline;

  constructor(
    public rollupDb: RollupDb,
    public worldStateDb: WorldStateDb,
    private blockchain: Blockchain,
    private pipelineFactory: RollupPipelineFactory,
    private metrics: Metrics,
  ) {}

  public async start() {
    await this.worldStateDb.start();

    await this.syncState();

    await this.startNewPipeline();

    this.blockchain.on('block', block => this.blockQueue.put(block));
    await this.blockchain.start(await this.rollupDb.getNextRollupId());

    this.blockQueue.process(block => this.handleBlock(block));
  }

  public async stop() {
    this.blockQueue.cancel();
    this.blockchain.stop();
    await this.pipeline.stop();
    this.worldStateDb.stop();
  }

  public flushTxs() {
    this.pipeline.flushTxs();
  }

  /**
   * Called at startup to bring us back in sync.
   * Erases any orphaned rollup proofs and unsettled rollups from rollup db.
   * Processes all rollup blocks from the last settled rollup in the rollup db.
   */
  private async syncState() {
    this.printState();
    console.log('Syncing state...');

    const nextRollupId = await this.rollupDb.getNextRollupId();
    const blocks = await this.blockchain.getBlocks(nextRollupId);

    for (const block of blocks) {
      await this.updateDbs(block);
    }

    // This deletes all proofs created until now. Not ideal, figure out a way to resume.
    await this.rollupDb.deleteUnsettledRollups();
    await this.rollupDb.deleteOrphanedRollupProofs();

    console.log('Sync complete.');
  }

  public printState() {
    console.log(`Data size: ${this.worldStateDb.getSize(0)}`);
    console.log(`Data root: ${this.worldStateDb.getRoot(0).toString('hex')}`);
    console.log(`Null root: ${this.worldStateDb.getRoot(1).toString('hex')}`);
    console.log(`Root root: ${this.worldStateDb.getRoot(2).toString('hex')}`);
  }

  /**
   * Called to purge all received, unsettled txs, and reset the rollup pipeline.
   */
  public async resetPipeline() {
    await this.pipeline.stop();
    await this.worldStateDb.rollback();
    await this.rollupDb.deleteUnsettledRollups();
    await this.rollupDb.deleteOrphanedRollupProofs();
    await this.rollupDb.deletePendingTxs();
    await this.startNewPipeline();
  }

  public async getLastPublishedTime() {
    return this.pipeline.getLastPublishedTime();
  }

  private async startNewPipeline() {
    this.pipeline = await this.pipelineFactory.create();
    this.pipeline.start().catch(async err => {
      console.log('PIPELINE PANIC!');
      console.log(err);
    });
  }

  /**
   * Called in serial to process each incoming block.
   * Stops the pipeline, stopping any current rollup construction or publishing.
   * Processes the block, loading it's data into the db.
   * Starts a new pipeline.
   */
  private async handleBlock(block: Block) {
    await this.pipeline.stop();
    await this.updateDbs(block);
    await this.startNewPipeline();
  }

  /**
   * Inserts the rollup in the given block into the merkle tree and sql db.
   */
  private async updateDbs(block: Block) {
    const end = this.metrics.processBlockTimer();
    const { rollupProofData: rawRollupData, viewingKeysData } = block;
    const rollupProofData = RollupProofData.fromBuffer(rawRollupData, viewingKeysData);
    const { rollupId, rollupHash, newDataRoot } = rollupProofData;

    console.log(`Processing rollup ${rollupId}: ${rollupHash.toString('hex')}...`);

    if (newDataRoot.equals(this.worldStateDb.getRoot(0))) {
      // This must be the rollup we just published. Commit the world state.
      await this.worldStateDb.commit();
    } else {
      // Someone elses rollup. Discard any of our world state modifications and update world state with new rollup.
      await this.worldStateDb.rollback();
      await this.addRollupToWorldState(rollupProofData);
    }

    await this.confirmOrAddRollupToDb(rollupProofData, block);

    this.printState();
    end();
  }

  private async confirmOrAddRollupToDb(rollup: RollupProofData, block: Block) {
    const { txHash, rollupProofData: proofData, created } = block;

    const rollupProof = await this.rollupDb.getRollupProof(rollup.rollupHash, true);
    if (rollupProof) {
      // Our rollup. Confirm mined and track settlement times.
      await this.rollupDb.confirmMined(rollup.rollupId, block.gasUsed, block.gasPrice, block.created, block.txHash);

      for (const inner of rollup.innerProofData) {
        if (inner.isPadding()) {
          continue;
        }
        const tx = rollupProof.txs.find(tx => tx.id.equals(inner.txId));
        if (!tx) {
          console.log('Rollup tx missing. Not tracking time...');
          continue;
        }
        this.metrics.txSettlementDuration(block.created.getTime() - tx.created.getTime());
      }
    } else {
      // Not a rollup we created. Add or replace rollup.
      const rollupProofDao = new RollupProofDao();
      rollupProofDao.id = rollup.rollupHash;
      rollupProofDao.rollupSize = rollup.rollupSize;
      rollupProofDao.dataStartIndex = rollup.dataStartIndex;
      rollupProofDao.proofData = proofData;
      rollupProofDao.txs = rollup.innerProofData
        .filter(tx => !tx.isPadding())
        .map((p, i) => innerProofDataToTxDao(p, rollup.viewingKeys[i], created));
      rollupProofDao.created = created;

      const rollupDao = new RollupDao({
        id: rollup.rollupId,
        dataRoot: rollup.newDataRoot,
        rollupProof: rollupProofDao,
        ethTxHash: txHash.toBuffer(),
        mined: block.created,
        created: block.created,
        viewingKeys: Buffer.concat(rollup.viewingKeys.flat().map(vk => vk.toBuffer())),
        gasPrice: toBufferBE(block.gasPrice, 32),
        gasUsed: block.gasUsed,
      });

      await this.rollupDb.addRollup(rollupDao);
    }
  }

  private async addRollupToWorldState(rollup: RollupProofData) {
    const { rollupId, dataStartIndex, innerProofData } = rollup;
    for (let i = 0; i < innerProofData.length; ++i) {
      const tx = innerProofData[i];
      await this.worldStateDb.put(0, BigInt(dataStartIndex + i * 2), tx.newNote1);
      await this.worldStateDb.put(0, BigInt(dataStartIndex + i * 2 + 1), tx.newNote2);
      if (!tx.isPadding()) {
        await this.worldStateDb.put(1, toBigIntBE(tx.nullifier1), toBufferBE(1n, 64));
        await this.worldStateDb.put(1, toBigIntBE(tx.nullifier2), toBufferBE(1n, 64));
      }
    }

    await this.worldStateDb.put(2, BigInt(rollupId + 1), this.worldStateDb.getRoot(0));

    await this.worldStateDb.commit();
  }
}
