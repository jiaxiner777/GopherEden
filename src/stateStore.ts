import * as vscode from 'vscode';

import { getGrowthStage } from './petConfig';
import { SHOP_ITEMS, getShopItem } from './catalog';
import {
  EdenState,
  EdenTheme,
  FurnitureAnchorType,
  FurnitureKind,
  HabitatPoint,
  InventoryEntry,
  PetLineage,
  PetLineageSource,
  PetStatus,
  PlacedFurniture,
} from './types';

const STATE_FILE_NAME = 'eden.json';

const DEFAULT_STATE: EdenState = {
  schemaVersion: 5,
  totalBricks: 0,
  inspirationDew: 0,
  petName: 'Moss',
  petLineage: 'primitives',
  petLineageSource: 'auto',
  petLineageSettled: false,
  growthPoints: 0,
  growthStage: 'stage-a',
  successfulSaveCount: 0,
  theme: 'cyber-oasis',
  petAnchorLine: 0,
  petAnchorDocument: null,
  inventory: [],
  placedFurniture: [],
  petDockPosition: { x: 0.88, y: 0.66 },
  totalMeaningfulLinesAdded: 0,
  petStatus: 'normal',
  editorPetEnabled: true,
  editorPetScale: 100,
};

type LegacyPlacement = {
  id?: string;
  kind?: string;
  x?: number;
  y?: number;
};

type LegacyState = Partial<Omit<EdenState, 'schemaVersion' | 'inventory' | 'placedFurniture'>> & {
  placements?: readonly LegacyPlacement[];
  inventory?: readonly InventoryEntry[];
  placedFurniture?: readonly PlacedFurniture[];
};

export class EdenStateStore {
  private state: EdenState = DEFAULT_STATE;

  public constructor(private readonly context: vscode.ExtensionContext) {}

  public async initialize(): Promise<EdenState> {
    this.state = await this.loadState();
    await this.persist();
    return this.state;
  }

  public getState(): EdenState {
    return this.state;
  }

  public getStateFileUri(): vscode.Uri | undefined {
    const workspaceFolder = resolveProjectWorkspaceFolder();
    if (!workspaceFolder) {
      return undefined;
    }

    return vscode.Uri.joinPath(workspaceFolder.uri, '.vscode', STATE_FILE_NAME);
  }

  public async update(patch: Partial<EdenState>): Promise<EdenState> {
    this.state = this.normalizeState({ ...this.state, ...patch });
    await this.persist();
    return this.state;
  }

  public async setTheme(theme: EdenTheme): Promise<EdenState> {
    return this.update({ theme });
  }

  public async setPetStatus(petStatus: PetStatus): Promise<EdenState> {
    return this.update({ petStatus });
  }

  public async setPetLineage(
    petLineage: PetLineage,
    petLineageSource: PetLineageSource = 'manual',
    petLineageSettled = true,
  ): Promise<EdenState> {
    return this.update({ petLineage, petLineageSource, petLineageSettled });
  }

  public async addGrowthPoints(delta: number): Promise<EdenState> {
    if (delta <= 0) {
      return this.state;
    }

    return this.update({ growthPoints: this.state.growthPoints + delta });
  }

  public async recordSuccessfulSave(growthDelta = 3): Promise<EdenState> {
    return this.update({
      successfulSaveCount: this.state.successfulSaveCount + 1,
      growthPoints: this.state.growthPoints + Math.max(0, growthDelta),
    });
  }

  public async setEditorPetEnabled(editorPetEnabled: boolean): Promise<EdenState> {
    return this.update({ editorPetEnabled });
  }

  public async setEditorPetScale(editorPetScale: number): Promise<EdenState> {
    return this.update({ editorPetScale: sanitizeEditorPetScale(editorPetScale) });
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

  public async purchaseItem(kind: FurnitureKind): Promise<EdenState> {
    const item = getShopItem(kind);
    if (!item) {
      throw new Error('商店里没有这个物品。');
    }

    if (this.state.totalBricks < item.priceBricks || this.state.inspirationDew < item.priceDew) {
      throw new Error(`资源不够，购买 ${item.name} 需要 ${item.priceBricks} 碎砖和 ${item.priceDew} 露珠。`);
    }

    return this.update({
      totalBricks: this.state.totalBricks - item.priceBricks,
      inspirationDew: this.state.inspirationDew - item.priceDew,
      inventory: addInventory(this.state.inventory, kind, 1),
    });
  }

  public async placeFurnitureInDock(kind: FurnitureKind): Promise<EdenState> {
    this.ensureInventory(kind);
    const dockCount = this.state.placedFurniture.filter((item) => item.anchorType === 'dock').length;
    const placement: PlacedFurniture = {
      id: `${kind}-${Date.now()}`,
      kind,
      anchorType: 'dock',
      documentUri: null,
      line: 0,
      x: clamp(0.88 - dockCount * 0.12, 0.12, 0.92),
      y: clamp(0.76 - (dockCount % 2) * 0.05, 0.18, 0.86),
    };

    return this.update({
      inventory: addInventory(this.state.inventory, kind, -1),
      placedFurniture: [...this.state.placedFurniture, placement],
    });
  }

  public async placeFurnitureInEditor(
    kind: FurnitureKind,
    anchorType: Exclude<FurnitureAnchorType, 'dock'>,
    documentUri: string,
    line: number,
  ): Promise<EdenState> {
    this.ensureInventory(kind);

    const placement: PlacedFurniture = {
      id: `${kind}-${Date.now()}`,
      kind,
      anchorType,
      documentUri,
      line: Math.max(0, line),
      x: anchorType === 'viewport-float' ? 0.86 : 0.82,
      y: anchorType === 'viewport-float' ? 0.72 : 0.5,
    };

    return this.update({
      inventory: addInventory(this.state.inventory, kind, -1),
      placedFurniture: [...this.state.placedFurniture, placement],
    });
  }

  public async movePlacement(id: string, position: HabitatPoint): Promise<EdenState> {
    const placedFurniture = this.state.placedFurniture.map((placement) =>
      placement.id === id
        ? {
            ...placement,
            ...sanitizePoint(position, placement),
          }
        : placement,
    );

    return this.update({ placedFurniture });
  }

  public async nudgePlacement(id: string, dx: number, dy: number): Promise<EdenState> {
    const placedFurniture = this.state.placedFurniture.map((placement) => {
      if (placement.id !== id) {
        return placement;
      }

      return {
        ...placement,
        x: clamp(placement.x + dx, 0.04, 0.96),
        y: clamp(placement.y + dy, 0.08, 0.9),
      };
    });

    return this.update({ placedFurniture });
  }

  public async shiftPlacementLine(id: string, delta: number): Promise<EdenState> {
    const placedFurniture = this.state.placedFurniture.map((placement) =>
      placement.id === id
        ? {
            ...placement,
            line: Math.max(0, placement.line + delta),
          }
        : placement,
    );

    return this.update({ placedFurniture });
  }

  public async changePlacementAnchor(
    id: string,
    anchorType: FurnitureAnchorType,
    context?: { documentUri?: string | null; line?: number },
  ): Promise<EdenState> {
    const placedFurniture = this.state.placedFurniture.map((placement) => {
      if (placement.id !== id) {
        return placement;
      }

      const documentUri =
        anchorType === 'dock'
          ? null
          : context?.documentUri ?? placement.documentUri ?? this.state.petAnchorDocument;
      const line =
        anchorType === 'dock' ? 0 : Math.max(0, context?.line ?? placement.line ?? this.state.petAnchorLine);

      return {
        ...placement,
        anchorType,
        documentUri,
        line,
        x: anchorType === 'dock' ? clamp(placement.x, 0.12, 0.92) : clamp(placement.x, 0.68, 0.96),
        y:
          anchorType === 'dock'
            ? clamp(placement.y, 0.18, 0.86)
            : anchorType === 'viewport-float'
              ? clamp(placement.y, 0.16, 0.84)
              : clamp(placement.y, 0.18, 0.82),
      };
    });

    return this.update({ placedFurniture });
  }

  public async returnPlacementToInventory(id: string): Promise<EdenState> {
    const placement = this.state.placedFurniture.find((item) => item.id === id);
    if (!placement) {
      return this.state;
    }

    return this.update({
      inventory: addInventory(this.state.inventory, placement.kind, 1),
      placedFurniture: this.state.placedFurniture.filter((item) => item.id !== id),
    });
  }

  public async returnAllPlacementsToInventory(): Promise<EdenState> {
    if (this.state.placedFurniture.length === 0) {
      return this.state;
    }

    const counts = new Map<FurnitureKind, number>();
    for (const placement of this.state.placedFurniture) {
      counts.set(placement.kind, (counts.get(placement.kind) ?? 0) + 1);
    }

    let inventory = this.state.inventory;
    for (const [kind, count] of counts.entries()) {
      inventory = addInventory(inventory, kind, count);
    }

    return this.update({
      inventory,
      placedFurniture: [],
    });
  }

  public async deletePlacement(id: string): Promise<EdenState> {
    return this.update({
      placedFurniture: this.state.placedFurniture.filter((item) => item.id !== id),
    });
  }

  private async loadState(): Promise<EdenState> {
    const fileUri = this.getStateFileUri();
    if (fileUri) {
      try {
        const content = await vscode.workspace.fs.readFile(fileUri);
        const parsed = JSON.parse(Buffer.from(content).toString('utf8')) as LegacyState;
        return this.normalizeState(parsed);
      } catch (error) {
        if (!isMissingFileError(error)) {
          console.warn('[GopherEden] Failed to read project state file.', error);
        }
      }
    }

    return this.normalizeState(undefined);
  }

  private async persist(): Promise<void> {
    const fileUri = this.getStateFileUri();
    if (!fileUri) {
      return;
    }

    const workspaceFolder = resolveProjectWorkspaceFolder();
    if (!workspaceFolder) {
      return;
    }

    const directoryUri = vscode.Uri.joinPath(workspaceFolder.uri, '.vscode');
    await vscode.workspace.fs.createDirectory(directoryUri);
    const content = JSON.stringify(this.state, null, 2);
    await vscode.workspace.fs.writeFile(fileUri, Buffer.from(content, 'utf8'));
  }

  private normalizeState(state: LegacyState | Partial<EdenState> | undefined): EdenState {
    const legacyState = state as LegacyState | undefined;
    const inventory = normalizeInventory(state?.inventory ?? DEFAULT_STATE.inventory);
    const placedFurniture = normalizePlacements(
      state?.placedFurniture,
      legacyState?.placements,
      state?.petAnchorDocument ?? DEFAULT_STATE.petAnchorDocument,
      state?.petAnchorLine ?? DEFAULT_STATE.petAnchorLine,
    );

    const hasSavedLineage = isPetLineage(state?.petLineage);
    const normalizedGrowthPoints = Math.max(0, state?.growthPoints ?? DEFAULT_STATE.growthPoints);
    const growthStage = getGrowthStage(normalizedGrowthPoints).id;

    return {
      schemaVersion: 5,
      totalBricks: Math.max(0, state?.totalBricks ?? DEFAULT_STATE.totalBricks),
      inspirationDew: Math.max(0, state?.inspirationDew ?? DEFAULT_STATE.inspirationDew),
      petName: state?.petName?.trim() || DEFAULT_STATE.petName,
      petLineage: hasSavedLineage ? (state!.petLineage as PetLineage) : DEFAULT_STATE.petLineage,
      petLineageSource: hasSavedLineage ? normalizePetLineageSource(state?.petLineageSource) : 'auto',
      petLineageSettled: hasSavedLineage ? (state?.petLineageSettled ?? true) : false,
      growthPoints: normalizedGrowthPoints,
      growthStage,
      successfulSaveCount: Math.max(0, state?.successfulSaveCount ?? DEFAULT_STATE.successfulSaveCount),
      theme: state?.theme ?? DEFAULT_STATE.theme,
      petAnchorLine: Math.max(0, state?.petAnchorLine ?? DEFAULT_STATE.petAnchorLine),
      petAnchorDocument: state?.petAnchorDocument ?? DEFAULT_STATE.petAnchorDocument,
      inventory,
      placedFurniture,
      petDockPosition: sanitizePoint(state?.petDockPosition, DEFAULT_STATE.petDockPosition),
      totalMeaningfulLinesAdded: Math.max(
        0,
        state?.totalMeaningfulLinesAdded ?? DEFAULT_STATE.totalMeaningfulLinesAdded,
      ),
      petStatus: state?.petStatus ?? DEFAULT_STATE.petStatus,
      editorPetEnabled: state?.editorPetEnabled ?? DEFAULT_STATE.editorPetEnabled,
      editorPetScale: sanitizeEditorPetScale(state?.editorPetScale ?? DEFAULT_STATE.editorPetScale),
    };
  }

  private ensureInventory(kind: FurnitureKind): void {
    const owned = this.state.inventory.find((item) => item.kind === kind)?.count ?? 0;
    if (owned <= 0) {
      throw new Error(`背包里没有可摆放的 ${getShopItem(kind)?.name ?? kind}。`);
    }
  }
}

function resolveProjectWorkspaceFolder(): vscode.WorkspaceFolder | undefined {
  const activeEditor = vscode.window.activeTextEditor;
  if (activeEditor) {
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(activeEditor.document.uri);
    if (workspaceFolder) {
      return workspaceFolder;
    }
  }

  return vscode.workspace.workspaceFolders?.[0];
}

function normalizePlacements(
  placedFurniture: readonly PlacedFurniture[] | undefined,
  legacyPlacements: readonly LegacyPlacement[] | undefined,
  fallbackDocumentUri: string | null,
  fallbackLine: number,
): readonly PlacedFurniture[] {
  const next: PlacedFurniture[] = [];
  const useLegacyPlacements = !Array.isArray(placedFurniture);

  for (const placement of placedFurniture ?? []) {
    const normalized = normalizePlacement(placement, fallbackDocumentUri, fallbackLine);
    if (normalized) {
      next.push(normalized);
    }
  }

  if (useLegacyPlacements) {
    for (const placement of legacyPlacements ?? []) {
      if ((placement.kind ?? 'piano') !== 'piano') {
        continue;
      }

      next.push({
        id: typeof placement.id === 'string' ? placement.id : `piano-${Date.now()}`,
        kind: 'piano',
        anchorType: 'dock',
        documentUri: null,
        line: 0,
        ...sanitizePoint(placement, { x: 0.88, y: 0.78 }),
      });
    }
  }

  return dedupePlacements(next);
}

function dedupePlacements(placements: readonly PlacedFurniture[]): readonly PlacedFurniture[] {
  const seen = new Set<string>();
  const result: PlacedFurniture[] = [];

  for (const placement of placements) {
    const key = `${placement.id}:${placement.kind}:${placement.anchorType}:${placement.documentUri ?? 'dock'}:${placement.line}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(placement);
  }

  return result;
}

function normalizePlacement(
  value: unknown,
  fallbackDocumentUri: string | null,
  fallbackLine: number,
): PlacedFurniture | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const placement = value as Partial<PlacedFurniture> & { id?: unknown; kind?: unknown };
  if (!isFurnitureKind(placement.kind)) {
    return undefined;
  }

  const anchorType = isFurnitureAnchorType(placement.anchorType) ? placement.anchorType : 'dock';

  return {
    id: typeof placement.id === 'string' ? placement.id : `${placement.kind}-${Date.now()}`,
    kind: placement.kind,
    anchorType,
    documentUri:
      anchorType === 'dock'
        ? null
        : typeof placement.documentUri === 'string'
          ? placement.documentUri
          : fallbackDocumentUri,
    line: anchorType === 'dock' ? 0 : Math.max(0, placement.line ?? fallbackLine),
    ...sanitizePoint(placement, anchorType === 'dock' ? { x: 0.88, y: 0.78 } : { x: 0.84, y: 0.68 }),
  };
}

function normalizeInventory(entries: readonly InventoryEntry[]): readonly InventoryEntry[] {
  const counts = new Map<FurnitureKind, number>();

  for (const entry of entries) {
    if (!isFurnitureKind(entry.kind)) {
      continue;
    }

    counts.set(entry.kind, Math.max(0, counts.get(entry.kind) ?? 0) + Math.max(0, entry.count));
  }

  return SHOP_ITEMS
    .map((item) => ({
      kind: item.kind,
      count: counts.get(item.kind) ?? 0,
    }))
    .filter((entry) => entry.count > 0);
}

function addInventory(
  entries: readonly InventoryEntry[],
  kind: FurnitureKind,
  delta: number,
): readonly InventoryEntry[] {
  const counts = new Map<FurnitureKind, number>();

  for (const entry of entries) {
    counts.set(entry.kind, entry.count);
  }

  counts.set(kind, Math.max(0, (counts.get(kind) ?? 0) + delta));

  return SHOP_ITEMS
    .map((item) => ({
      kind: item.kind,
      count: counts.get(item.kind) ?? 0,
    }))
    .filter((entry) => entry.count > 0);
}

function sanitizePoint(value: Partial<HabitatPoint> | undefined, fallback: HabitatPoint): HabitatPoint {
  return {
    x: clamp(typeof value?.x === 'number' ? value.x : fallback.x, 0.04, 0.96),
    y: clamp(typeof value?.y === 'number' ? value.y : fallback.y, 0.08, 0.9),
  };
}

function sanitizeEditorPetScale(value: number): number {
  return Math.round(clamp(value, 70, 220) / 10) * 10;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function normalizePetLineageSource(value: unknown): PetLineageSource {
  return value === 'manual' ? 'manual' : 'auto';
}

function isPetLineage(value: unknown): value is PetLineage {
  return value === 'primitives' || value === 'concurrency' || value === 'protocols' || value === 'chaos';
}

function isFurnitureKind(value: unknown): value is FurnitureKind {
  return value === 'piano' || value === 'bench' || value === 'tree' || value === 'lamp' || value === 'grass';
}

function isFurnitureAnchorType(value: unknown): value is FurnitureAnchorType {
  return value === 'line-bind' || value === 'viewport-float' || value === 'dock';
}

function isMissingFileError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return /FileNotFound|ENOENT|EntryNotFound/i.test(error.message);
}
