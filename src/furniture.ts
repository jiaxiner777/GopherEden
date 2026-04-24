import { getFurnitureAssetFileName } from './mediaPaths';
import { FurnitureKind } from './types';

export const FURNITURE_LABELS: Readonly<Record<FurnitureKind, string>> = {
  piano: '像素钢琴',
  bench: '小木椅',
  tree: '像素盆栽',
  lamp: '复古台灯',
  grass: '小游戏机',
};

export const FURNITURE_ASSET_FILES: Readonly<Record<FurnitureKind, string>> = {
  piano: 'piano.svg',
  bench: 'bench.svg',
  tree: 'tree.svg',
  lamp: 'lamp.svg',
  grass: 'grass.svg',
};

export function getFurnitureLabel(kind: FurnitureKind): string {
  return FURNITURE_LABELS[kind];
}

export function getFurnitureAssetFile(kind: FurnitureKind): string {
  return getFurnitureAssetFileName(kind);
}
