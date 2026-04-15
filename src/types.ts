export type EdenTheme = 'cyber-oasis' | 'pixel-meadow';

export type PetStatus = 'normal' | 'startled' | 'working';
export type PetEffectKind = 'heart' | 'sparkle' | 'alert';

export type FurnitureKind = 'piano' | 'bench' | 'tree' | 'lamp' | 'grass';

export type FurnitureAnchorType = 'line-bind' | 'viewport-float' | 'dock';

export interface HabitatPoint {
  readonly x: number;
  readonly y: number;
}

export interface InventoryEntry {
  readonly kind: FurnitureKind;
  readonly count: number;
}

export interface PlacedFurniture extends HabitatPoint {
  readonly id: string;
  readonly kind: FurnitureKind;
  readonly anchorType: FurnitureAnchorType;
  readonly documentUri: string | null;
  readonly line: number;
}

export interface ShopItem {
  readonly kind: FurnitureKind;
  readonly name: string;
  readonly description: string;
  readonly priceBricks: number;
  readonly priceDew: number;
}

export interface EdenState {
  readonly schemaVersion: 2;
  readonly totalBricks: number;
  readonly inspirationDew: number;
  readonly petName: string;
  readonly theme: EdenTheme;
  readonly petAnchorLine: number;
  readonly petAnchorDocument: string | null;
  readonly inventory: readonly InventoryEntry[];
  readonly placedFurniture: readonly PlacedFurniture[];
  readonly petDockPosition: HabitatPoint;
  readonly totalMeaningfulLinesAdded: number;
  readonly petStatus: PetStatus;
  readonly editorPetEnabled: boolean;
  readonly editorPetScale: number;
}

export interface EditorPetUiState {
  readonly enabled: boolean;
  readonly actuallyVisible: boolean;
  readonly toggleLabel: string;
  readonly statusText: string;
}

export interface EdenViewState {
  readonly state: EdenState;
  readonly editorPet: EditorPetUiState;
  readonly shopItems: readonly ShopItem[];
  readonly petAnimationFrame: number;
  readonly petEffect: PetEffectKind | null;
  readonly petEffectNonce: number;
}
