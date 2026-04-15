export type EdenTheme = 'cyber-oasis' | 'pixel-meadow';

export type PetStatus = 'normal' | 'startled' | 'working';

export interface HabitatPoint {
  readonly x: number;
  readonly y: number;
}

export interface FurniturePlacement extends HabitatPoint {
  readonly id: string;
  readonly kind: 'piano';
}

export interface EdenState {
  readonly totalBricks: number;
  readonly inspirationDew: number;
  readonly petName: string;
  readonly theme: EdenTheme;
  readonly petAnchorLine: number;
  readonly petAnchorDocument: string | null;
  readonly placements: readonly FurniturePlacement[];
  readonly petDockPosition: HabitatPoint;
  readonly totalMeaningfulLinesAdded: number;
  readonly petStatus: PetStatus;
  readonly editorPetEnabled: boolean;
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
}