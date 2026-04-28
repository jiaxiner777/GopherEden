import * as fs from 'fs';
import * as path from 'path';

import { FurnitureKind, ShopItem } from './types';

export interface DecorationAssetConfig {
  readonly label: string;
  readonly description: string;
  readonly path: string;
  readonly width: number;
  readonly height: number;
  readonly editorSize?: number;
  readonly shop?: {
    readonly priceBricks: number;
    readonly priceDew: number;
  };
}

export interface FloorTileAssetConfig {
  readonly label: string;
  readonly path: string;
  readonly maskPath?: string;
  readonly width: number;
  readonly height: number;
}

export interface RoomAssetsConfig {
  readonly decorations: Readonly<Record<string, DecorationAssetConfig>>;
  readonly floorTiles: Readonly<Record<string, FloorTileAssetConfig>>;
}

export interface StageWindowConfig {
  readonly pos: readonly [number, number];
  readonly size: readonly [number, number];
  readonly frameColor: string;
  readonly glassColor: string;
  readonly glowColor: string;
}

export interface StageRugConfig {
  readonly pos: readonly [number, number];
  readonly size: readonly [number, number];
  readonly color: string;
  readonly stripeColor: string;
}

export interface RoomLayoutConfig {
  readonly tileSize: number;
  readonly stage: {
    readonly cols: number;
    readonly rows: number;
    readonly floorStartRow: number;
    readonly floorRows: number;
  };
  readonly theme: {
    readonly wallColor: string;
    readonly wallStripeColor: string;
    readonly wallStripeWidth: number;
    readonly backdropColor: string;
    readonly trimColor: string;
    readonly window: StageWindowConfig;
    readonly rug?: StageRugConfig;
  };
  readonly floor: string;
  readonly staticDecorations: readonly {
    readonly id: string;
    readonly pos: readonly [number, number];
  }[];
}

interface RoomConfigBundle {
  readonly assets: RoomAssetsConfig;
  readonly layout: RoomLayoutConfig;
}

let cachedBundle: RoomConfigBundle | undefined;

export function getRoomAssetsConfig(): RoomAssetsConfig {
  return loadBundle().assets;
}

export function getRoomLayoutConfig(): RoomLayoutConfig {
  return loadBundle().layout;
}

export function getFurnitureKinds(): readonly FurnitureKind[] {
  return Object.keys(getRoomAssetsConfig().decorations);
}

export function isKnownFurnitureKind(value: unknown): value is FurnitureKind {
  return typeof value === 'string' && value in getRoomAssetsConfig().decorations;
}

export function getFurnitureDefinition(kind: FurnitureKind): DecorationAssetConfig {
  const definition = getRoomAssetsConfig().decorations[kind];
  if (!definition) {
    throw new Error(`Unknown furniture kind: ${kind}`);
  }
  return definition;
}

export function getFurnitureLabel(kind: FurnitureKind): string {
  return getFurnitureDefinition(kind).label;
}

export function getFurnitureAssetPath(kind: FurnitureKind): readonly string[] {
  return splitRelativePath(getFurnitureDefinition(kind).path);
}

export function getFloorTileDefinition(floorId: string): FloorTileAssetConfig {
  const definition = getRoomAssetsConfig().floorTiles[floorId];
  if (!definition) {
    throw new Error(`Unknown floor tile id: ${floorId}`);
  }
  return definition;
}

export function getShopItemsFromConfig(): readonly ShopItem[] {
  return getFurnitureKinds()
    .map((kind) => {
      const definition = getFurnitureDefinition(kind);
      if (!definition.shop) {
        return undefined;
      }
      return {
        kind,
        name: definition.label,
        description: definition.description,
        priceBricks: definition.shop.priceBricks,
        priceDew: definition.shop.priceDew,
      } satisfies ShopItem;
    })
    .filter((item): item is ShopItem => Boolean(item));
}

export function getShopItemFromConfig(kind: FurnitureKind): ShopItem | undefined {
  const def = getRoomAssetsConfig().decorations[kind];
  if (!def?.shop) {
    return undefined;
  }
  return {
    kind,
    name: def.label,
    description: def.description,
    priceBricks: def.shop.priceBricks,
    priceDew: def.shop.priceDew,
  };
}

export function getFloorTileAssetPath(floorId: string): readonly string[] {
  return splitRelativePath(getFloorTileDefinition(floorId).path);
}

export function getFloorTileMaskPath(floorId: string): readonly string[] | undefined {
  const def = getFloorTileDefinition(floorId);
  return def.maskPath ? splitRelativePath(def.maskPath) : undefined;
}

export function resolveMediaFsPath(relativePath: string): string {
  return path.resolve(__dirname, '..', 'media', ...splitRelativePath(relativePath));
}

export function splitRelativePath(relativePath: string): readonly string[] {
  return relativePath.split('/').filter((segment) => segment.length > 0);
}

function loadBundle(): RoomConfigBundle {
  if (cachedBundle) {
    return cachedBundle;
  }

  cachedBundle = {
    assets: readJsonFile<RoomAssetsConfig>('assets.json'),
    layout: readJsonFile<RoomLayoutConfig>('room-layout.json'),
  };
  return cachedBundle;
}

function readJsonFile<T>(fileName: string): T {
  const filePath = path.resolve(__dirname, '..', 'media', 'config', fileName);
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
}
