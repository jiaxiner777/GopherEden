export type EdenTheme = 'cyber-oasis' | 'pixel-meadow';

export type PetStatus = 'normal' | 'startled' | 'working';
export type PetLineage = 'primitives' | 'concurrency' | 'protocols' | 'chaos';
export type PetLineageSource = 'auto' | 'manual';
export type GrowthStageId = 'stage-a' | 'stage-b' | 'stage-c';
export type PetEffectKind = 'heart' | 'sparkle' | 'alert';
export type PetIdleBehavior =
  | 'settled'
  | 'breath-hold'
  | 'glance-left'
  | 'glance-right'
  | 'head-tilt-left'
  | 'head-tilt-right'
  | 'curious-lean'
  | 'posture-reset'
  | 'attentive-freeze';

export type FurnitureKind = string;

export type FurniturePlacementType = 'floor' | 'wall';

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
  readonly placementType: FurniturePlacementType;
  readonly priceBricks: number;
  readonly priceDew: number;
}

export interface EdenState {
  readonly schemaVersion: 5;
  readonly totalBricks: number;
  readonly inspirationDew: number;
  readonly petName: string;
  readonly petLineage: PetLineage;
  readonly petLineageSource: PetLineageSource;
  readonly petLineageSettled: boolean;
  readonly growthPoints: number;
  readonly growthStage: GrowthStageId;
  readonly successfulSaveCount: number;
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

export interface GrowthUiState {
  readonly lineage: PetLineage;
  readonly lineageLabel: string;
  readonly lineageHint: string;
  readonly lineageSource: PetLineageSource;
  readonly lineageSourceLabel: string;
  readonly lineageSourceHint: string;
  readonly growthPoints: number;
  readonly stageId: GrowthStageId;
  readonly stageLabel: string;
  readonly stageDescription: string;
  readonly stageMinPoints: number;
  readonly pointsToNextStage: number;
  readonly nextStageMinPoints: number | null;
  readonly nextStageLabel: string | null;
  readonly currentStatusLabel: string;
  readonly currentStatusHint: string;
  readonly preferredFurnitureLabel: string;
  readonly behaviorHint: string;
  readonly stageAbilityTitle: string;
  readonly stageAbilityHint: string;
}

export interface PetVisualUiState {
  readonly lineage: PetLineage;
  readonly lineageLabel: string;
  readonly stageId: GrowthStageId;
  readonly stageLabel: string;
  readonly paletteKey: string;
  readonly visualVariant: string;
  readonly detailLevel: 'minimal' | 'growing' | 'complete';
  readonly sidebarScale: number;
  readonly dockScale: number;
  readonly editorScaleMultiplier: number;
  readonly motionMultiplier: number;
  readonly idleMotionMs: number;
  readonly workingMotionMs: number;
  readonly alertMotionMs: number;
  readonly sidebarFilter: string;
  readonly dockFilter: string;
  readonly accentColor: string;
  readonly preferredFurnitureLabel: string;
}

export interface PetMotionUiState {
  readonly frameIndex: 0 | 1;
  readonly bodyOffsetX: number;
  readonly bodyOffsetY: number;
  readonly bodyRotateDeg: number;
  readonly bodyScaleX: number;
  readonly bodyScaleY: number;
  readonly headOffsetX: number;
  readonly headOffsetY: number;
  readonly headRotateDeg: number;
  readonly gazeX: number;
  readonly gazeY: number;
  readonly focusOpacity: number;
  readonly posture: number;
  readonly anticipation: number;
  readonly emotionalArousal: number;
  readonly emotionalValence: number;
  readonly motionEnergy: number;
  readonly shadowScale: number;
  readonly shadowOpacity: number;
  readonly activeBehavior: PetIdleBehavior;
}

export interface EdenViewState {
  readonly state: EdenState;
  readonly editorPet: EditorPetUiState;
  readonly growth: GrowthUiState;
  readonly petVisual: PetVisualUiState;
  readonly petMotion: PetMotionUiState;
  readonly shopItems: readonly ShopItem[];
  readonly petAnimationFrame: number;
  readonly petEffect: PetEffectKind | null;
  readonly petEffectNonce: number;
}
