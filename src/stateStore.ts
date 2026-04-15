import * as vscode from 'vscode';

import {
  EdenState,
  EdenTheme,
  FurniturePlacement,
  HabitatPoint,
  PetStatus,
} from './types';

const STATE_KEY = 'gophersEden.state';

const DEFAULT_STATE: EdenState = {
  totalBricks: 0,
  inspirationDew: 0,
  petName: 'Moss',
  theme: 'cyber-oasis',
  petAnchorLine: 0,
  petAnchorDocument: null,
  placements: [],
  petDockPosition: { x: 0.88, y: 0.66 },
  totalMeaningfulLinesAdded: 0,
  petStatus: 'normal',
  editorPetEnabled: true,
};

export class EdenStateStore {
  private state: EdenState;

  public constructor(private readonly storage: vscode.Memento) {
    this.state = this.normalizeState(storage.get<EdenState>(STATE_KEY));
  }

  public getState(): EdenState {
    return this.state;
  }

  public async update(patch: Partial<EdenState>): Promise<EdenState> {
    this.state = this.normalizeState({ ...this.state, ...patch });
    await this.storage.update(STATE_KEY, this.state);
    return this.state;
  }

  public async setTheme(theme: EdenTheme): Promise<EdenState> {
    return this.update({ theme });
  }

  public async setPetStatus(petStatus: PetStatus): Promise<EdenState> {
    return this.update({ petStatus });
  }

  public async setEditorPetEnabled(editorPetEnabled: boolean): Promise<EdenState> {
    return this.update({ editorPetEnabled });
  }

  public async setPetAnchor(documentUri: string | null, line: number): Promise<EdenState> {
    return this.update({
      petAnchorDocument: documentUri,
      petAnchorLine: Math.max(0, line),
    });
  }

  public async setPetDockPosition(position: HabitatPoint): Promise<EdenState> {
    return this.update({ petDockPosition: sanitizePoint(position, DEFAULT_STATE.petDockPosition) });
  }

  public async addPiano(): Promise<EdenState> {
    const pianoCount = this.state.placements.filter((placement) => placement.kind === 'piano').length;
    const placement: FurniturePlacement = {
      id: `piano-${Date.now()}`,
      kind: 'piano',
      x: clamp(0.9 - pianoCount * 0.14, 0.1, 0.9),
      y: 0.78,
    };

    return this.update({ placements: [...this.state.placements, placement] });
  }

  public async movePlacement(id: string, position: HabitatPoint): Promise<EdenState> {
    const placements = this.state.placements.map((placement) =>
      placement.id === id
        ? {
            ...placement,
            ...sanitizePoint(position, placement),
          }
        : placement,
    );

    return this.update({ placements });
  }

  private normalizeState(state: Partial<EdenState> | undefined): EdenState {
    const placements = (state?.placements ?? DEFAULT_STATE.placements)
      .map((placement) => normalizePlacement(placement))
      .filter((placement): placement is FurniturePlacement => placement !== undefined);

    return {
      ...DEFAULT_STATE,
      ...state,
      placements,
      petDockPosition: sanitizePoint(state?.petDockPosition, DEFAULT_STATE.petDockPosition),
      theme: state?.theme ?? DEFAULT_STATE.theme,
      petStatus: state?.petStatus ?? DEFAULT_STATE.petStatus,
      editorPetEnabled: state?.editorPetEnabled ?? DEFAULT_STATE.editorPetEnabled,
      petAnchorLine: Math.max(0, state?.petAnchorLine ?? DEFAULT_STATE.petAnchorLine),
      petAnchorDocument: state?.petAnchorDocument ?? DEFAULT_STATE.petAnchorDocument,
      totalBricks: Math.max(0, state?.totalBricks ?? DEFAULT_STATE.totalBricks),
      inspirationDew: Math.max(0, state?.inspirationDew ?? DEFAULT_STATE.inspirationDew),
      totalMeaningfulLinesAdded: Math.max(
        0,
        state?.totalMeaningfulLinesAdded ?? DEFAULT_STATE.totalMeaningfulLinesAdded,
      ),
      petName: state?.petName?.trim() || DEFAULT_STATE.petName,
    };
  }
}

function normalizePlacement(value: unknown): FurniturePlacement | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const placement = value as Partial<FurniturePlacement> & { id?: unknown };
  const kind = placement.kind === 'piano' || placement.id === 'piano' ? 'piano' : undefined;
  if (!kind) {
    return undefined;
  }

  return {
    id: typeof placement.id === 'string' ? placement.id : `piano-${Date.now()}`,
    kind,
    ...sanitizePoint(placement, { x: 0.88, y: 0.78 }),
  };
}

function sanitizePoint(value: Partial<HabitatPoint> | undefined, fallback: HabitatPoint): HabitatPoint {
  return {
    x: clamp(typeof value?.x === 'number' ? value.x : fallback.x, 0.04, 0.96),
    y: clamp(typeof value?.y === 'number' ? value.y : fallback.y, 0.08, 0.9),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}