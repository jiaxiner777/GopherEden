import { FurnitureKind } from './types';

export const FURNITURE_LABELS: Readonly<Record<FurnitureKind, string>> = {
  piano: '钢琴',
  bench: '长椅',
  tree: '小树',
  lamp: '小灯',
  grass: '草堆',
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
  return FURNITURE_ASSET_FILES[kind];
}
