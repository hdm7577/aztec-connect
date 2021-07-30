import { toBigIntBE, toBufferBE } from '../bigint_buffer';
import { AccountId } from '../account_id';
import { ViewingKey } from '../viewing_key';
import { BarretenbergWasm } from '../wasm';
import { BarretenbergWorker } from '../wasm/worker';
import { DefiInteractionNote } from './defi_interaction_note';
import { TreeClaimNote } from './tree_claim_note';
import { TreeNote } from './tree_note';
import debug from 'debug';

export class NoteAlgorithms {
  constructor(private wasm: BarretenbergWasm, private worker: BarretenbergWorker = wasm as any) {}

  public valueNoteNullifier(noteCommitment: Buffer, index: number, accountPrivateKey: Buffer, real = true) {
    this.wasm.transferToHeap(noteCommitment, 0);
    this.wasm.transferToHeap(accountPrivateKey, 64);
    this.wasm.call('notes__value_note_nullifier', 0, 64, index, real, 0);
    return Buffer.from(this.wasm.sliceMemory(0, 32));
  }

  public valueNoteNullifierBigInt(noteCommitment: Buffer, index: number, accountPrivateKey: Buffer, real = true) {
    return toBigIntBE(this.valueNoteNullifier(noteCommitment, index, accountPrivateKey, real));
  }

  public valueNoteCommitment(note: TreeNote) {
    const noteBuf = note.toBuffer();
    const mem = this.wasm.call('bbmalloc', noteBuf.length);
    this.wasm.transferToHeap(noteBuf, mem);
    this.wasm.call('notes__value_note_commitment', mem, 0);
    this.wasm.call('bbfree', mem);
    return Buffer.from(this.wasm.sliceMemory(0, 32));
  }

  public valueNotePartialCommitment(noteSecret: Buffer, owner: AccountId) {
    this.wasm.transferToHeap(noteSecret, 0);
    this.wasm.transferToHeap(owner.publicKey.toBuffer(), 32);
    this.wasm.call('notes__value_note_partial_commitment', 0, 32, owner.nonce, 0);
    return Buffer.from(this.wasm.sliceMemory(0, 32));
  }

  public claimNotePartialCommitment(note: TreeClaimNote) {
    const noteBuf = note.toBuffer();
    const mem = this.wasm.call('bbmalloc', noteBuf.length);
    this.wasm.transferToHeap(noteBuf, mem);
    this.wasm.call('notes__claim_note_partial_commitment', mem, 0);
    this.wasm.call('bbfree', mem);
    return Buffer.from(this.wasm.sliceMemory(0, 32));
  }

  public claimNoteCompletePartialCommitment(partialNote: Buffer, interactionNonce: number, fee: bigint) {
    this.wasm.transferToHeap(partialNote, 0);
    this.wasm.transferToHeap(toBufferBE(fee, 32), 32);
    this.wasm.call('notes__claim_note_complete_partial_commitment', 0, interactionNonce, 32, 0);
    return Buffer.from(this.wasm.sliceMemory(0, 32));
  }

  public claimNoteCommitment(note: TreeClaimNote) {
    const partial = this.claimNotePartialCommitment(note);
    return this.claimNoteCompletePartialCommitment(partial, note.defiInteractionNonce, note.fee);
  }

  public claimNoteNullifier(noteCommitment: Buffer, index: number) {
    this.wasm.transferToHeap(noteCommitment, 0);
    this.wasm.call('notes__claim_note_nullifier', 0, index, 0);
    return Buffer.from(this.wasm.sliceMemory(0, 32));
  }

  public defiInteractionNoteCommitment(note: DefiInteractionNote) {
    const noteBuf = note.toBuffer();
    const mem = this.wasm.call('bbmalloc', noteBuf.length);
    this.wasm.transferToHeap(noteBuf, mem);
    this.wasm.call('notes__defi_interaction_note_commitment', mem, 0);
    this.wasm.call('bbfree', mem);
    return Buffer.from(this.wasm.sliceMemory(0, 32));
  }

  public async batchDecryptNotes(keysBuf: Buffer, privateKey: Buffer) {
    const decryptedNoteLength = 41;
    const numKeys = keysBuf.length / ViewingKey.SIZE;

    const mem = await this.worker.call('bbmalloc', keysBuf.length + privateKey.length);
    await this.worker.transferToHeap(keysBuf, mem);
    await this.worker.transferToHeap(privateKey, mem + keysBuf.length);

    await this.worker.call('notes__batch_decrypt_notes', mem, mem + keysBuf.length, numKeys, mem);
    const dataBuf: Buffer = Buffer.from(await this.worker.sliceMemory(mem, mem + numKeys * decryptedNoteLength));
    await this.worker.call('bbfree', mem);
    return dataBuf;
  }
}