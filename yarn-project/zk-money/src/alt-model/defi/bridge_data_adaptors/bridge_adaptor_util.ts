import type { RemoteAsset } from '../../../alt-model/types.js';
import { EthAddress } from '@aztec/sdk';
import { AztecAsset, AztecAssetType } from '@aztec/bridge-clients/client-dest/src/client/bridge-data.js';
import { BridgeInteractionAssets } from '../types.js';

export const UNUSED_ADAPTOR_ASSET: AztecAsset = {
  id: 0,
  assetType: AztecAssetType.NOT_USED,
  erc20Address: EthAddress.ZERO as any,
};

// Will be used once we have a bridge with virtual assets
// function toAdaptorVirtualAsset(assetId: number): AztecAsset {
//   return {
//     id: BigInt(assetId),
//     assetType: AztecAssetType.VIRTUAL,
//     erc20Address: ZERO_ADDRESS_STR,
//   };
// }

export function toAdaptorAsset(asset: RemoteAsset): AztecAsset {
  return {
    id: asset.id,
    assetType: asset.id === 0 ? AztecAssetType.ETH : AztecAssetType.ERC20,
    erc20Address: asset.address as any,
  };
}

export function toAdaptorArgs({ inA, outA }: BridgeInteractionAssets) {
  return {
    inA: toAdaptorAsset(inA),
    inB: UNUSED_ADAPTOR_ASSET,
    outA: toAdaptorAsset(outA),
    outB: UNUSED_ADAPTOR_ASSET,
  };
}