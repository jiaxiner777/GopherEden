import * as vscode from 'vscode';

import { SHOP_ITEMS } from './catalog';
import { debounce } from './debounce';
import { DockMessage, EdenDockProvider } from './dockProvider';
import { getFurnitureAssetFile, getFurnitureLabel } from './furniture';
import { getPetAssetUri } from './mediaPaths';
import {
  getGrowthStage,
  PET_LINEAGES,
  PET_LINEAGE_ORDER,
  scoreLineageDetection,
  getLineageDefinition,
  getMotionProfile,
} from './petConfig';
import { EdenSidebarProvider, SidebarMessage } from './sidebarProvider';
import { EdenStateStore } from './stateStore';
import {
  EdenState,
  EdenViewState,
  EditorPetUiState,
  FurnitureAnchorType,
  FurnitureKind,
  GrowthUiState,
  PetEffectKind,
  PetLineage,
  PetStatus,
  PetVisualUiState,
  PlacedFurniture,
} from './types';

type PetMood = 'normal' | 'alert' | 'working';
type PetRenderMode = 'floating' | 'dock-edge';
type PetRenderReason = 'visible' | 'disabled' | 'no-editor' | 'layout';
type PetAffinityReason = 'error' | 'save' | 'placement' | 'interaction';

interface ActivityWindowEntry {
  readonly at: number;
  readonly addedLines: number;
}

interface PetRenderTarget {
  readonly reason: PetRenderReason;
  readonly mode?: PetRenderMode;
  readonly editor?: vscode.TextEditor;
  readonly displayLine?: number;
  readonly anchorLine?: number;
  readonly topOffset?: number;
}

interface FurnitureRenderTarget {
  readonly placement: PlacedFurniture;
  readonly editor: vscode.TextEditor;
  readonly displayLine: number;
  readonly anchorLine: number;
  readonly topOffset: number;
  readonly marginLeft: number;
}

interface ViewportMetrics {
  readonly visibleRange: vscode.Range;
  readonly lengths: readonly number[];
  readonly sortedLengths: readonly number[];
  readonly averageLength: number;
  readonly medianLength: number;
  readonly p70Length: number;
  readonly p80Length: number;
  readonly p90Length: number;
  readonly shortLineCount: number;
  readonly mediumLineCount: number;
}

const PET_BASE_ICON_SIZE = 72;
const PET_SCALE_MIN = 70;
const PET_SCALE_MAX = 220;
const PET_FLOAT_OFFSET_X = 118;
const PET_EDGE_OFFSET_X = 98;
const PET_MAX_ANCHOR_LENGTH = 132;
const PET_MAX_FLOAT_LINE_LENGTH = 116;
const PET_MAX_EDGE_LINE_LENGTH = 92;
const FURNITURE_MAX_LINE_LENGTH = 142;
const FURNITURE_BASE_OFFSET_X = 88;
const FURNITURE_FLOAT_OFFSET_X = 98;
const FURNITURE_OPACITY = '0.74';
const PET_ANIMATION_INTERVAL_MS = 320;

const FURNITURE_ICON_SIZES: Readonly<Record<FurnitureKind, number>> = {
  piano: 30,
  bench: 26,
  tree: 30,
  lamp: 24,
  grass: 26,
};

class EdenController implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private readonly renderDebounced: () => void;
  private readonly stateStore: EdenStateStore;
  private readonly sidebarProvider: EdenSidebarProvider;
  private readonly dockProvider: EdenDockProvider;
  private petDecorations: Record<PetMood, readonly vscode.TextEditorDecorationType[]>;
  private currentPetDecorationSignature = '';
  private readonly furnitureDecorations: Record<FurnitureKind, vscode.TextEditorDecorationType>;
  private readonly statusBarItem: vscode.StatusBarItem;

  private workingAnimationTimer: NodeJS.Timeout | undefined;
  private petAnimationTimer: NodeJS.Timeout | undefined;
  private petEffectTimer: NodeJS.Timeout | undefined;
  private petFollowupEffectTimer: NodeJS.Timeout | undefined;
  private petAnimationTick = 0;
  private petEffect: PetEffectKind | null = null;
  private petEffectNonce = 0;
  private hasErrors = false;
  private activityWindow: ActivityWindowEntry[] = [];
  private dockVisible = false;

  public constructor(private readonly context: vscode.ExtensionContext) {
    this.stateStore = new EdenStateStore();
    this.sidebarProvider = new EdenSidebarProvider(context.extensionUri);
    this.dockProvider = new EdenDockProvider(context.extensionUri, (visible) => {
      this.dockVisible = visible;
      this.renderDebounced();
      void this.refreshStateDisplay();
    });

    const debounceMs = vscode.workspace
      .getConfiguration('gophersEden')
      .get<number>('renderDebounceMs', 120);
    this.renderDebounced = debounce(() => {
      void this.renderAndSync();
    }, debounceMs);

    this.petDecorations = this.createAllPetDecorations(this.stateStore.getState().editorPetScale);
    this.furnitureDecorations = {
      piano: this.createFurnitureDecoration('piano'),
      bench: this.createFurnitureDecoration('bench'),
      tree: this.createFurnitureDecoration('tree'),
      lamp: this.createFurnitureDecoration('lamp'),
      grass: this.createFurnitureDecoration('grass'),
    };
    this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    this.statusBarItem.text = '$(symbol-misc) Gopher 底部乐园';
    this.statusBarItem.tooltip = '真正的拖拽和互动都放在底部乐园里完成';
    this.statusBarItem.command = 'gophersEden.openDock';

    this.disposables.push(
      ...Object.values(this.furnitureDecorations),
      this.statusBarItem,
    );
  }

  public async initialize(): Promise<void> {
    await this.stateStore.initialize();
    this.rebuildPetDecorationsForState();

    this.disposables.push(this.registerSidebar());
    this.disposables.push(this.registerDock());
    this.disposables.push(this.registerCommands());
    this.disposables.push(this.registerEventListeners());
    this.statusBarItem.show();
    this.startAnimationLoop();

    const activeEditor = vscode.window.activeTextEditor;
    if (activeEditor && this.isEligibleEditor(activeEditor)) {
      await this.stateStore.setPetAnchor(
        activeEditor.document.uri.toString(),
        activeEditor.selection.active.line,
      );
    }

    if (!this.stateStore.getState().petLineageSettled) {
      await this.redetectPetLineage(false);
    }

    await this.refreshErrorState();
    await this.renderAndSync();
  }

  public dispose(): void {
    if (this.workingAnimationTimer) {
      clearTimeout(this.workingAnimationTimer);
      this.workingAnimationTimer = undefined;
    }

    if (this.petAnimationTimer) {
      clearInterval(this.petAnimationTimer);
      this.petAnimationTimer = undefined;
    }

    if (this.petEffectTimer) {
      clearTimeout(this.petEffectTimer);
      this.petEffectTimer = undefined;
    }

    if (this.petFollowupEffectTimer) {
      clearTimeout(this.petFollowupEffectTimer);
      this.petFollowupEffectTimer = undefined;
    }

    for (const decoration of Object.values(this.petDecorations).flat()) {
      decoration.dispose();
    }

    for (const disposable of this.disposables) {
      disposable.dispose();
    }
  }

  private registerSidebar(): vscode.Disposable {
    return vscode.window.registerWebviewViewProvider(
      EdenSidebarProvider.viewType,
      {
        resolveWebviewView: (webviewView, context, token) => {
          this.sidebarProvider.resolveWebviewView(webviewView, context, token);
          webviewView.webview.onDidReceiveMessage((message: SidebarMessage) => {
            void this.handleSidebarMessage(message);
          });
          this.sidebarProvider.postState(this.buildViewState());
        },
      },
      {
        webviewOptions: {
          retainContextWhenHidden: true,
        },
      },
    );
  }

  private registerDock(): vscode.Disposable {
    return vscode.window.registerWebviewViewProvider(
      EdenDockProvider.viewType,
      {
        resolveWebviewView: (webviewView, context, token) => {
          this.dockProvider.resolveWebviewView(webviewView, context, token);
          webviewView.webview.onDidReceiveMessage((message: DockMessage) => {
            void this.handleDockMessage(message);
          });
          this.dockProvider.postState(this.buildViewState());
        },
      },
      {
        webviewOptions: {
          retainContextWhenHidden: true,
        },
      },
    );
  }

  private registerCommands(): vscode.Disposable {
    return vscode.Disposable.from(
      vscode.commands.registerCommand('gophersEden.openHabitat', async () => {
        await this.openHabitat();
      }),
      vscode.commands.registerCommand('gophersEden.openDock', async () => {
        await this.openDock();
      }),
      vscode.commands.registerCommand('gophersEden.renamePet', async () => {
        await this.renamePet();
      }),
      vscode.commands.registerCommand('gophersEden.playWithPet', async () => {
        await this.playWithPet();
      }),
      vscode.commands.registerCommand('gophersEden.redetectLineage', async () => {
        await this.redetectPetLineage(true);
      }),
      vscode.commands.registerCommand('gophersEden.switchTheme', async (theme?: string) => {
        if (theme === 'cyber-oasis' || theme === 'pixel-meadow') {
          await this.stateStore.setTheme(theme);
          await this.renderAndSync();
        }
      }),
      vscode.commands.registerCommand('gophersEden.toggleEditorPet', async () => {
        await this.toggleEditorPet();
      }),
    );
  }

  private registerEventListeners(): vscode.Disposable {
    return vscode.Disposable.from(
      vscode.workspace.onDidChangeTextDocument((event) => {
        void this.handleTextDocumentChange(event);
      }),
      vscode.workspace.onDidSaveTextDocument((document) => {
        void this.handleDocumentSave(document);
      }),
      vscode.window.onDidChangeTextEditorSelection((event) => {
        void this.handleSelectionChange(event);
      }),
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        void this.handleActiveEditorChange(editor);
      }),
      vscode.window.onDidChangeVisibleTextEditors(() => {
        void this.refreshErrorState();
        this.renderDebounced();
      }),
      vscode.window.onDidChangeTextEditorVisibleRanges(() => {
        this.renderDebounced();
      }),
      vscode.languages.onDidChangeDiagnostics(() => {
        void this.refreshErrorState();
      }),
    );
  }

  private async handleSidebarMessage(message: SidebarMessage): Promise<void> {
    switch (message.type) {
      case 'ready':
        await this.refreshStateDisplay();
        return;
      case 'openDock':
        await this.openDock();
        return;
      case 'renamePet':
        await this.renamePet();
        return;
      case 'playWithPet':
        await this.playWithPet();
        return;
      case 'toggleEditorPet':
        await this.toggleEditorPet();
        return;
      case 'setEditorPetScale':
        await this.setEditorPetScale(message.scale);
        return;
      case 'setLineage':
        await this.setPetLineageManually(message.lineage);
        return;
      case 'redetectLineage':
        await this.redetectPetLineage(true);
        return;
      case 'returnAllPlacements':
        await this.returnAllPlacementsToInventory();
        return;
      case 'setTheme':
        await this.stateStore.setTheme(message.theme);
        await this.renderAndSync();
        return;
      case 'buyItem':
        await this.buyItem(message.kind);
        return;
      case 'placeFurniture':
        await this.placeFurniture(message.kind, message.anchorType);
        return;
      case 'placementAction':
        await this.handlePlacementAction(message.id, message.action);
        return;
      default:
        return;
    }
  }

  private async handleDockMessage(message: DockMessage): Promise<void> {
    switch (message.type) {
      case 'ready':
        await this.refreshStateDisplay();
        return;
      case 'renamePet':
        await this.renamePet();
        return;
      case 'playWithPet':
        await this.playWithPet();
        return;
      case 'toggleEditorPet':
        await this.toggleEditorPet();
        return;
      case 'openHabitat':
        await this.openHabitat();
        return;
      case 'returnAllPlacements':
        await this.returnAllPlacementsToInventory();
        return;
      case 'movePet':
        await this.stateStore.setPetDockPosition({ x: message.x, y: message.y });
        await this.refreshStateDisplay();
        this.renderDebounced();
        return;
      case 'moveFurniture':
        await this.stateStore.movePlacement(message.id, { x: message.x, y: message.y });
        await this.renderAndSync();
        return;
      case 'placementAction':
        await this.handlePlacementAction(message.id, message.action);
        return;
      default:
        return;
    }
  }

  private async openHabitat(): Promise<void> {
    await vscode.commands.executeCommand('workbench.view.extension.gophersEden');
    await vscode.commands.executeCommand('gophersEden.sidebar.focus');
  }

  private async openDock(): Promise<void> {
    await vscode.commands.executeCommand('workbench.view.extension.gophersEdenPanel');
    await vscode.commands.executeCommand('gophersEden.dock.focus');
  }

  private async renamePet(): Promise<void> {
    const currentName = this.stateStore.getState().petName;
    const nextName = await vscode.window.showInputBox({
      title: '给宠物起名',
      prompt: '输入一个你喜欢的名字，它会显示在侧边栏和底部乐园里。',
      value: currentName,
      validateInput: (value) => value.trim().length === 0 ? '名字不能为空。' : undefined,
    });

    if (!nextName) {
      return;
    }

    await this.stateStore.update({ petName: nextName.trim() });
    await this.renderAndSync();
  }

  private async playWithPet(): Promise<void> {
    const state = this.stateStore.getState();
    const stage = getGrowthStage(state.growthPoints);
    const lineage = getLineageDefinition(state.petLineage);
    await this.stateStore.addGrowthPoints(stage.growthProfile.interactionGain);
    this.showPetEffect('heart', stage.id === 'stage-c' ? 1700 : 1400);
    if (stage.id !== 'stage-a') {
      this.scheduleFollowupEffect('sparkle', stage.id === 'stage-c' ? 260 : 420);
      await this.settlePetByFurnitureAffinity('interaction');
    }

    void vscode.window.setStatusBarMessage(
      `${state.petName}${buildInteractionMessage(lineage.id, stage.id)}，成长值 +${stage.growthProfile.interactionGain}。`,
      2400,
    );
    await this.renderAndSync();
  }

  private async toggleEditorPet(): Promise<void> {
    const current = this.stateStore.getState();
    await this.stateStore.setEditorPetEnabled(!current.editorPetEnabled);
    await this.renderAndSync();
  }

  private async setEditorPetScale(scale: number): Promise<void> {
    const nextScale = sanitizePetScale(scale);
    const current = this.stateStore.getState();
    if (current.editorPetScale === nextScale) {
      await this.refreshStateDisplay();
      return;
    }

    await this.stateStore.setEditorPetScale(nextScale);
    this.rebuildPetDecorationsForState();
    await this.renderAndSync();
  }

  private async buyItem(kind: FurnitureKind): Promise<void> {
    try {
      const stage = getGrowthStage(this.stateStore.getState().growthPoints);
      await this.stateStore.purchaseItem(kind);
      await this.stateStore.addGrowthPoints(stage.growthProfile.purchaseGain);
      const item = SHOP_ITEMS.find((entry) => entry.kind === kind);
      if (item) {
        this.showPetEffect('sparkle');
        void vscode.window.setStatusBarMessage(
          `已购买 ${item.name}，已经放进背包，成长值 +${stage.growthProfile.purchaseGain}。`,
          2600,
        );
      }
      await this.renderAndSync();
    } catch (error) {
      await vscode.window.showWarningMessage(toErrorMessage(error));
    }
  }

  private async placeFurniture(kind: FurnitureKind, anchorType: FurnitureAnchorType): Promise<void> {
    try {
      const stage = getGrowthStage(this.stateStore.getState().growthPoints);
      if (anchorType === 'dock') {
        await this.stateStore.placeFurnitureInDock(kind);
        await this.stateStore.addGrowthPoints(stage.growthProfile.placementGain);
        await this.settlePetByFurnitureAffinity('placement', [kind]);
        await this.renderAndSync();
        await this.openDock();
        return;
      }

      const editor = this.getPlaceableEditor();
      if (!editor) {
        await vscode.window.showWarningMessage('请先打开一个本地文件，再把家具摆到代码区。');
        return;
      }

      await this.stateStore.placeFurnitureInEditor(
        kind,
        anchorType,
        editor.document.uri.toString(),
        editor.selection.active.line,
      );
      await this.stateStore.setPetAnchor(editor.document.uri.toString(), editor.selection.active.line);
      await this.stateStore.addGrowthPoints(stage.growthProfile.placementGain);
      await this.settlePetByFurnitureAffinity('placement', [kind]);
      await this.renderAndSync();
    } catch (error) {
      await vscode.window.showWarningMessage(toErrorMessage(error));
    }
  }

  private async handlePlacementAction(id: string, action: string): Promise<void> {
    const placement = this.stateStore.getState().placedFurniture.find((item) => item.id === id);
    if (!placement) {
      return;
    }

    try {
      switch (action) {
        case 'return':
          await this.stateStore.returnPlacementToInventory(id);
          break;
        case 'delete':
          await this.stateStore.deletePlacement(id);
          break;
        case 'to-dock':
          await this.stateStore.changePlacementAnchor(id, 'dock');
          await this.openDock();
          break;
        case 'to-line-bind': {
          const context = this.resolvePlacementEditorContext(placement);
          if (!context) {
            await vscode.window.showWarningMessage('没有可用的文件编辑器，无法切回跟行模式。');
            return;
          }

          await this.stateStore.changePlacementAnchor(id, 'line-bind', context);
          break;
        }
        case 'to-viewport-float': {
          const context = this.resolvePlacementEditorContext(placement);
          if (!context) {
            await vscode.window.showWarningMessage('没有可用的文件编辑器，无法切回浮层模式。');
            return;
          }

          await this.stateStore.changePlacementAnchor(id, 'viewport-float', context);
          break;
        }
        case 'nudge-left':
          await this.stateStore.nudgePlacement(id, -0.05, 0);
          break;
        case 'nudge-right':
          await this.stateStore.nudgePlacement(id, 0.05, 0);
          break;
        case 'nudge-up':
          if (placement.anchorType === 'line-bind') {
            await this.stateStore.shiftPlacementLine(id, -1);
          } else {
            await this.stateStore.nudgePlacement(id, 0, -0.05);
          }
          break;
        case 'nudge-down':
          if (placement.anchorType === 'line-bind') {
            await this.stateStore.shiftPlacementLine(id, 1);
          } else {
            await this.stateStore.nudgePlacement(id, 0, 0.05);
          }
          break;
        default:
          return;
      }

      await this.renderAndSync();
    } catch (error) {
      await vscode.window.showWarningMessage(toErrorMessage(error));
    }
  }

  private async returnAllPlacementsToInventory(): Promise<void> {
    const placedCount = this.stateStore.getState().placedFurniture.length;
    if (placedCount === 0) {
      void vscode.window.setStatusBarMessage('当前没有已摆放家具需要收回。', 2200);
      return;
    }

    await this.stateStore.returnAllPlacementsToInventory();
    await this.renderAndSync();
    void vscode.window.setStatusBarMessage(`已将 ${placedCount} 个摆件全部收回背包。`, 2600);
  }

  private resolvePlacementEditorContext(
    placement: PlacedFurniture,
  ): { documentUri: string; line: number } | undefined {
    const editor = this.getPlaceableEditor();
    if (editor) {
      return {
        documentUri: editor.document.uri.toString(),
        line: editor.selection.active.line,
      };
    }

    if (placement.documentUri) {
      return {
        documentUri: placement.documentUri,
        line: placement.line,
      };
    }

    const state = this.stateStore.getState();
    if (state.petAnchorDocument) {
      return {
        documentUri: state.petAnchorDocument,
        line: state.petAnchorLine,
      };
    }

    return undefined;
  }

  private getPlaceableEditor(): vscode.TextEditor | undefined {
    return vscode.window.visibleTextEditors.find((editor) => this.isEligibleEditor(editor))
      ?? (vscode.window.activeTextEditor && this.isEligibleEditor(vscode.window.activeTextEditor)
        ? vscode.window.activeTextEditor
        : undefined);
  }

  private isEligibleEditor(editor: vscode.TextEditor | undefined): editor is vscode.TextEditor {
    return !!editor && editor.document.uri.scheme === 'file' && !this.isStateFileUri(editor.document.uri);
  }

  private isStateFileUri(uri: vscode.Uri): boolean {
    const stateFileUri = this.stateStore.getStateFileUri();
    return !!stateFileUri && stateFileUri.toString() === uri.toString();
  }

  private async handleTextDocumentChange(event: vscode.TextDocumentChangeEvent): Promise<void> {
    if (event.document.uri.scheme !== 'file' || this.isStateFileUri(event.document.uri)) {
      return;
    }

    if (!(await isResourceTrackedDocument(event.document))) {
      this.renderDebounced();
      return;
    }

    let addedMeaningfulLines = 0;
    let dewToAward = 0;

    for (const change of event.contentChanges) {
      const insertedLines = countMeaningfulLines(change.text);
      const removedLines = countRemovedLines(change.range);
      addedMeaningfulLines += insertedLines;
      if (removedLines >= 5 && insertedLines < removedLines) {
        dewToAward += 1;
      }
    }

    if (addedMeaningfulLines > 0) {
      await this.awardBricks(addedMeaningfulLines);
      const stage = getGrowthStage(this.stateStore.getState().growthPoints);
      await this.stateStore.addGrowthPoints(Math.min(stage.growthProfile.codeGainCap, addedMeaningfulLines));
      this.trackWorkingBurst(addedMeaningfulLines);
    }

    if (dewToAward > 0) {
      const current = this.stateStore.getState();
      await this.stateStore.update({ inspirationDew: current.inspirationDew + dewToAward });
    }

    const matchingEditor = vscode.window.visibleTextEditors.find(
      (editor) => editor.document.uri.toString() === event.document.uri.toString(),
    );

    if (matchingEditor && this.isEligibleEditor(matchingEditor)) {
      await this.stateStore.setPetAnchor(
        matchingEditor.document.uri.toString(),
        matchingEditor.selection.active.line,
      );
    }

    this.renderDebounced();
  }

  private async handleSelectionChange(event: vscode.TextEditorSelectionChangeEvent): Promise<void> {
    if (!this.isEligibleEditor(event.textEditor)) {
      return;
    }

    await this.stateStore.setPetAnchor(
      event.textEditor.document.uri.toString(),
      event.selections[0]?.active.line ?? 0,
    );
    this.renderDebounced();
  }

  private async handleActiveEditorChange(editor: vscode.TextEditor | undefined): Promise<void> {
    if (!this.isEligibleEditor(editor)) {
      return;
    }

    await this.stateStore.setPetAnchor(editor.document.uri.toString(), editor.selection.active.line);
    await this.refreshErrorState();
    this.renderDebounced();
  }

  private async handleDocumentSave(document: vscode.TextDocument): Promise<void> {
    if (document.uri.scheme !== 'file' || this.isStateFileUri(document.uri)) {
      return;
    }

    if (!(await isResourceTrackedDocument(document))) {
      return;
    }

    await this.refreshErrorState();
    if (this.hasErrors) {
      return;
    }

    await this.celebratePetSuccess();
  }

  private async awardBricks(addedMeaningfulLines: number): Promise<void> {
    const state = this.stateStore.getState();
    const previousBricks = state.totalBricks;
    const totalMeaningfulLinesAdded = state.totalMeaningfulLinesAdded + addedMeaningfulLines;
    const totalBricks = Math.floor(totalMeaningfulLinesAdded / 10);

    await this.stateStore.update({ totalMeaningfulLinesAdded, totalBricks });

    if (totalBricks > previousBricks) {
      const earned = totalBricks - previousBricks;
      this.showPetEffect('sparkle');
      void vscode.window.showInformationMessage(`Gopher 收集到了 ${earned} 块碎砖。`);
    }
  }

  private trackWorkingBurst(addedMeaningfulLines: number): void {
    const now = Date.now();
    this.activityWindow = this.activityWindow
      .filter((entry) => now - entry.at <= 2200)
      .concat({ at: now, addedLines: addedMeaningfulLines });

    const totalRecentLines = this.activityWindow.reduce((sum, entry) => sum + entry.addedLines, 0);
    const lineage = getLineageDefinition(this.stateStore.getState().petLineage);
    const threshold = lineage.id === 'concurrency' ? 16 : 20;
    if (totalRecentLines < threshold) {
      return;
    }

    if (this.workingAnimationTimer) {
      clearTimeout(this.workingAnimationTimer);
    }

    void this.setComputedStatus('working');
    this.workingAnimationTimer = setTimeout(() => {
      this.workingAnimationTimer = undefined;
      void this.refreshComputedStatus();
    }, lineage.id === 'concurrency' ? 6800 : 6200);
  }

  private async refreshErrorState(): Promise<void> {
    let errorCount = 0;
    for (const [, diagnostics] of vscode.languages.getDiagnostics()) {
      errorCount += diagnostics.filter(
        (diagnostic) => diagnostic.severity === vscode.DiagnosticSeverity.Error,
      ).length;
    }

    const hadErrors = this.hasErrors;
    this.hasErrors = errorCount > 0;
    if (!hadErrors && this.hasErrors) {
      this.showPetEffect('alert', 1800);
      await this.escapePetFromErrors();
    }

    await this.refreshComputedStatus();
  }

  private async refreshComputedStatus(): Promise<void> {
    if (this.hasErrors) {
      await this.setComputedStatus('startled');
      return;
    }

    if (this.workingAnimationTimer) {
      await this.setComputedStatus('working');
      return;
    }

    await this.setComputedStatus('normal');
  }

  private async setComputedStatus(status: PetStatus): Promise<void> {
    if (this.stateStore.getState().petStatus === status) {
      await this.renderAndSync();
      return;
    }

    await this.stateStore.setPetStatus(status);
    await this.renderAndSync();
  }

  private async setPetLineageManually(lineage: PetLineage): Promise<void> {
    const previous = this.stateStore.getState();
    await this.stateStore.setPetLineage(lineage, 'manual', true);
    await this.renderAndSync();

    const definition = getLineageDefinition(lineage);
    const prefix = previous.petLineage === lineage && previous.petLineageSource === 'manual'
      ? '当前项目宠物种族已保持为'
      : '已将当前项目宠物种族切换为';
    void vscode.window.showInformationMessage(
      `${prefix} ${definition.displayName}。后续不会被自动覆盖，除非你主动重新自动判定。`,
    );
  }

  private async redetectPetLineage(showNotice: boolean): Promise<void> {
    const nextLineage = await this.detectProjectLineage();
    const previous = this.stateStore.getState().petLineage;
    await this.stateStore.setPetLineage(nextLineage, 'auto', true);
    await this.renderAndSync();

    if (!showNotice) {
      return;
    }

    const definition = getLineageDefinition(nextLineage);
    const prefix = previous === nextLineage ? '已重新确认' : '已重新自动判定';
    void vscode.window.showInformationMessage(`${prefix}当前项目宠物种族：${definition.displayName}`);
  }

  private async detectProjectLineage(): Promise<PetLineage> {
    const scores: Record<PetLineage, number> = {
      primitives: 0,
      concurrency: 0,
      protocols: 0,
      chaos: 0,
    };
    const sampled = new Set<string>();

    const activeEditor = this.getPlaceableEditor();
    if (activeEditor && await isResourceTrackedDocument(activeEditor.document)) {
      await this.scoreDocumentForLineage(activeEditor.document, scores, 1.35);
      sampled.add(activeEditor.document.uri.toString());
    }

    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      const uris = await vscode.workspace.findFiles(
        new vscode.RelativePattern(folder, '**/*'),
        '**/{node_modules,dist,out,build,.git,.idea,.vscode}/**',
        180,
      );

      let used = 0;
      for (const uri of uris) {
        if (used >= 60 || sampled.has(uri.toString())) {
          continue;
        }

        sampled.add(uri.toString());
        try {
          const document = await vscode.workspace.openTextDocument(uri);
          if (!(await isResourceTrackedDocument(document))) {
            continue;
          }

          await this.scoreDocumentForLineage(document, scores, 1);
          used += 1;
        } catch {
          // Ignore unreadable files and keep detection lightweight.
        }
      }
    }

    let winner: PetLineage = 'primitives';
    let bestScore = Number.NEGATIVE_INFINITY;
    for (const lineage of PET_LINEAGE_ORDER) {
      const score = scores[lineage];
      if (score > bestScore + 0.001) {
        bestScore = score;
        winner = lineage;
      }
    }

    return winner;
  }

  private async scoreDocumentForLineage(
    document: vscode.TextDocument,
    scores: Record<PetLineage, number>,
    weight: number,
  ): Promise<void> {
    const text = document.getText().slice(0, 12000).toLowerCase();
    const errorCount = vscode.languages
      .getDiagnostics(document.uri)
      .filter((diagnostic) => diagnostic.severity === vscode.DiagnosticSeverity.Error)
      .length;
    const nestingCount = text.match(/\b(if|for|switch|try|catch)\b/g)?.length ?? 0;

    for (const lineage of PET_LINEAGES) {
      scores[lineage.id] += scoreLineageDetection(lineage, {
        languageId: document.languageId.toLowerCase(),
        text,
        lineCount: document.lineCount,
        nestingCount,
        errorCount,
      }) * weight;
    }
  }

  private async celebratePetSuccess(): Promise<void> {
    const state = this.stateStore.getState();
    const stage = getGrowthStage(state.growthPoints);
    const lineage = getLineageDefinition(state.petLineage);
    await this.stateStore.recordSuccessfulSave(stage.growthProfile.saveGrowthGain);

    let rewardText = '';
    if (stage.growthProfile.supportsCelebrationReward && stage.growthProfile.saveRewardBricks > 0) {
      const latest = this.stateStore.getState();
      await this.stateStore.update({ totalBricks: latest.totalBricks + stage.growthProfile.saveRewardBricks });
      rewardText = `，碎砖 +${stage.growthProfile.saveRewardBricks}`;
    }

    let stabilityText = '';
    const latest = this.stateStore.getState();
    if (latest.successfulSaveCount > 0 && latest.successfulSaveCount % 5 === 0) {
      await this.stateStore.addGrowthPoints(stage.growthProfile.stableDevelopmentBonusGain);
      stabilityText = `，稳定开发奖励成长值 +${stage.growthProfile.stableDevelopmentBonusGain}`;
    }

    if (stage.id === 'stage-a') {
      this.showPetEffect('heart', 1200);
    } else {
      this.showPetEffect('sparkle', stage.id === 'stage-c' ? 1800 : 1500);
      if (stage.id === 'stage-c') {
        this.scheduleFollowupEffect('heart', 260);
      }
      await this.settlePetByFurnitureAffinity('save');
    }

    void vscode.window.setStatusBarMessage(
      `${buildSaveMessage(lineage.id, stage.id)}，成长值 +${stage.growthProfile.saveGrowthGain}${rewardText}${stabilityText}。`,
      2800,
    );
    await this.refreshComputedStatus();
  }

  private async escapePetFromErrors(): Promise<void> {
    const state = this.stateStore.getState();
    const stage = getGrowthStage(state.growthPoints);
    const lineage = getLineageDefinition(state.petLineage);

    if (!stage.growthProfile.supportsEscapeSearch) {
      void vscode.window.setStatusBarMessage(buildErrorMessage(lineage.id, stage.id), 2200);
      await this.renderAndSync();
      return;
    }

    const escaped = await this.settlePetByFurnitureAffinity('error');
    void vscode.window.setStatusBarMessage(
      escaped ? buildErrorMessage(lineage.id, stage.id) : `${buildErrorMessage(lineage.id, stage.id)}，但附近没有合适的掩体。`,
      2400,
    );
    await this.renderAndSync();
  }

  private async settlePetByFurnitureAffinity(
    reason: PetAffinityReason,
    requestedKinds: readonly FurnitureKind[] = [],
  ): Promise<boolean> {
    const state = this.stateStore.getState();
    const stage = getGrowthStage(state.growthPoints);
    const lineage = getLineageDefinition(state.petLineage);
    const placements = state.placedFurniture;
    if (placements.length === 0) {
      return false;
    }

    const preferredKinds = mergeFurnitureKinds(lineage.preferredFurniture, requestedKinds);
    if (reason === 'save' && !stage.growthProfile.supportsCelebrationReward) {
      return false;
    }
    if (reason === 'error' && !stage.growthProfile.supportsEscapeSearch) {
      return false;
    }
    if (
      reason === 'placement' &&
      stage.growthProfile.furnitureAffinity === 'weak' &&
      !requestedKinds.some((kind) => lineage.preferredFurniture.includes(kind))
    ) {
      return false;
    }

    const activeDocumentUri = this.getPlaceableEditor()?.document.uri.toString();
    const candidates = [...placements].sort((left, right) => {
      const leftScore = scorePlacementPreference(left, preferredKinds, activeDocumentUri, stage.growthProfile.furnitureAffinity);
      const rightScore = scorePlacementPreference(right, preferredKinds, activeDocumentUri, stage.growthProfile.furnitureAffinity);
      return rightScore - leftScore;
    });

    const target = candidates[0];
    if (!target) {
      return false;
    }

    if (stage.growthProfile.furnitureAffinity === 'weak' && !preferredKinds.includes(target.kind)) {
      return false;
    }

    return this.movePetNearPlacement(target, reason);
  }

  private async movePetNearPlacement(
    placement: PlacedFurniture,
    reason: PetAffinityReason,
  ): Promise<boolean> {
    if (placement.anchorType === 'dock') {
      const offset = dockOffsetForReason(reason);
      await this.stateStore.setPetDockPosition({
        x: clampNumber(placement.x + offset.x, 0.1, 0.92),
        y: clampNumber(placement.y + offset.y, 0.18, 0.86),
      });
      return true;
    }

    if (!placement.documentUri) {
      return false;
    }

    const lineOffset = reason === 'error' ? 1 : 0;
    await this.stateStore.setPetAnchor(placement.documentUri, Math.max(0, placement.line + lineOffset));
    return true;
  }

  private buildGrowthUiState(state: EdenState): GrowthUiState {
    const stage = getGrowthStage(state.growthPoints);
    const lineage = getLineageDefinition(state.petLineage);
    const nextStage = getNextGrowthStage(stage.id);

    return {
      lineage: state.petLineage,
      lineageLabel: lineage.displayName,
      lineageHint: lineage.description,
      lineageSource: state.petLineageSource,
      lineageSourceLabel: state.petLineageSource === 'manual' ? '当前来源：手动选择' : '当前来源：自动判定',
      lineageSourceHint:
        state.petLineageSource === 'manual'
          ? '后续不会被自动覆盖，除非你主动重新自动判定。'
          : '首次进入项目时会根据代码特征打分判定。',
      growthPoints: state.growthPoints,
      stageId: stage.id,
      stageLabel: stage.displayName,
      stageDescription: stage.uiDescription,
      pointsToNextStage: nextStage ? Math.max(0, nextStage.minPoints - state.growthPoints) : 0,
      nextStageLabel: nextStage?.displayName ?? null,
      currentStatusLabel: describeCurrentStatus(state.petStatus, state.petLineage, stage.id, this.hasErrors),
      currentStatusHint: describeCurrentStatusHint(state.petStatus, state.petLineage, stage.id, this.hasErrors),
      preferredFurnitureLabel: lineage.preferredFurniture.map((kind) => getFurnitureLabel(kind)).join('、'),
      behaviorHint: lineage.behaviorHint,
      stageAbilityTitle: stage.abilityTitle,
      stageAbilityHint: `${stage.abilityHint} 当前已解锁：${stage.behaviorUnlocks.join('、')}。`,
    };
  }

  private buildPetVisualUiState(state: EdenState): PetVisualUiState {
    const stage = getGrowthStage(state.growthPoints);
    const lineage = getLineageDefinition(state.petLineage);
    return {
      lineage: state.petLineage,
      lineageLabel: lineage.displayName,
      stageId: stage.id,
      stageLabel: stage.displayName,
      paletteKey: lineage.paletteKey,
      visualVariant: lineage.visualVariant,
      detailLevel: stage.detailLevel,
      sidebarScale: stage.sidebarScaleMultiplier,
      dockScale: stage.dockScaleMultiplier,
      editorScaleMultiplier: stage.editorScaleMultiplier,
      idleMotionMs: getMotionProfile(state.petLineage, 'normal').motionMs,
      workingMotionMs: getMotionProfile(state.petLineage, 'working').motionMs,
      alertMotionMs: getMotionProfile(state.petLineage, 'startled').motionMs,
      sidebarFilter: lineage.sidebarFilter,
      dockFilter: lineage.dockFilter,
      accentColor: lineage.accentColor,
      preferredFurnitureLabel: lineage.preferredFurniture.map((kind) => getFurnitureLabel(kind)).join('、'),
    };
  }

  private buildViewState(): EdenViewState {
    const state = this.stateStore.getState();
    const target = this.resolvePetRenderTarget(state);
    return {
      state,
      editorPet: toEditorPetUiState(state, target, this.dockVisible),
      growth: this.buildGrowthUiState(state),
      petVisual: this.buildPetVisualUiState(state),
      shopItems: SHOP_ITEMS,
      petAnimationFrame: this.getPetAnimationFrame(state.petStatus),
      petEffect: this.petEffect,
      petEffectNonce: this.petEffectNonce,
    };
  }

  private async refreshStateDisplay(): Promise<void> {
    const viewState = this.buildViewState();
    this.sidebarProvider.postState(viewState);
    this.dockProvider.postState(viewState);
  }

  private async renderAndSync(): Promise<void> {
    this.ensurePetDecorationsCurrent();
    await this.render();
    await this.refreshStateDisplay();
  }

  private async render(): Promise<void> {
    const state = this.stateStore.getState();
    const petTarget = this.resolvePetRenderTarget(state);
    const furnitureTargets = this.resolveFurnitureTargets(state);
    const petMood = toPetMood(state.petStatus);

    for (const editor of vscode.window.visibleTextEditors) {
      clearPetDecorations(editor, this.petDecorations);
      clearFurnitureDecorations(editor, this.furnitureDecorations);
    }

    if (
      petTarget.reason === 'visible' &&
      petTarget.editor &&
      petTarget.displayLine !== undefined &&
      petTarget.anchorLine !== undefined
    ) {
      const anchorRange = endOfLineRange(petTarget.editor.document, petTarget.anchorLine);
      const activeDecoration = this.petDecorations[petMood][this.getPetAnimationFrame(state.petStatus)]
        ?? this.petDecorations[petMood][0];
      const topOffset = computeTopOffset(
        petTarget.editor,
        petTarget.anchorLine,
        petTarget.displayLine,
      ) + (petTarget.topOffset ?? 0);

      petTarget.editor.setDecorations(activeDecoration, [
        {
          range: anchorRange,
          renderOptions: {
            after: {
              margin: `0 0 0 ${petTarget.mode === 'dock-edge' ? PET_EDGE_OFFSET_X : PET_FLOAT_OFFSET_X}px`,
              textDecoration: buildOverlayCss(topOffset),
            },
          },
        },
      ]);
    }

    const grouped = new Map<vscode.TextEditor, Partial<Record<FurnitureKind, vscode.DecorationOptions[]>>>();

    for (const target of furnitureTargets) {
      const optionsForEditor = grouped.get(target.editor) ?? {};
      const options = optionsForEditor[target.placement.kind] ?? [];
      options.push({
        range: endOfLineRange(target.editor.document, target.anchorLine),
        hoverMessage: `${getFurnitureLabel(target.placement.kind)} · ${formatAnchorType(target.placement.anchorType)}`,
        renderOptions: {
          after: {
            margin: `0 0 0 ${target.marginLeft}px`,
            textDecoration: buildOverlayCss(target.topOffset),
          },
        },
      });
      optionsForEditor[target.placement.kind] = options;
      grouped.set(target.editor, optionsForEditor);
    }

    for (const [editor, perKind] of grouped.entries()) {
      for (const kind of Object.keys(this.furnitureDecorations) as FurnitureKind[]) {
        editor.setDecorations(this.furnitureDecorations[kind], perKind[kind] ?? []);
      }
    }
  }

  private resolvePetRenderTarget(state: EdenState): PetRenderTarget {
    if (!state.editorPetEnabled) {
      return { reason: 'disabled' };
    }

    const editor = this.getPetEditor(state);
    if (!editor || editor.document.uri.scheme !== 'file') {
      return { reason: 'no-editor' };
    }

    const metrics = collectViewportMetrics(editor, state.petAnchorLine);
    if (!metrics) {
      return { reason: 'layout', mode: this.dockVisible ? 'dock-edge' : 'floating' };
    }

    if (this.dockVisible || this.dockProvider.isVisible()) {
      const displayLine = pickDockDisplayLine(editor, metrics);
      const anchorLine = displayLine === undefined
        ? undefined
        : pickRightEdgeAnchorLine(editor, metrics, displayLine, PET_MAX_ANCHOR_LENGTH, true);
      if (displayLine === undefined || anchorLine === undefined) {
        return { reason: 'layout', mode: 'dock-edge' };
      }

      if (!hasInlinePetRoom(editor, displayLine, anchorLine, 'dock-edge')) {
        return { reason: 'layout', mode: 'dock-edge' };
      }

      return {
        reason: 'visible',
        mode: 'dock-edge',
        editor,
        displayLine,
        anchorLine,
        topOffset: dockEdgeTopOffset(editor),
      };
    }

    if (!hasViewportRightSafeSpace(metrics)) {
      return { reason: 'layout', mode: 'floating' };
    }

    const displayLine = pickFloatingLine(editor, metrics, state.petAnchorLine);
    const anchorLine = displayLine === undefined
      ? undefined
      : pickRightEdgeAnchorLine(editor, metrics, displayLine, PET_MAX_ANCHOR_LENGTH, false);
    if (displayLine === undefined || anchorLine === undefined) {
      return { reason: 'layout', mode: 'floating' };
    }

    if (!hasInlinePetRoom(editor, displayLine, anchorLine, 'floating')) {
      return { reason: 'layout', mode: 'floating' };
    }

    return {
      reason: 'visible',
      mode: 'floating',
      editor,
      displayLine,
      anchorLine,
      topOffset: 0,
    };
  }

  private getPetEditor(state: EdenState): vscode.TextEditor | undefined {
    const anchoredEditor = vscode.window.visibleTextEditors.find(
      (editor) => editor.document.uri.toString() === state.petAnchorDocument && this.isEligibleEditor(editor),
    );

    if (anchoredEditor) {
      return anchoredEditor;
    }

    return this.getPlaceableEditor();
  }

  private resolveFurnitureTargets(state: EdenState): readonly FurnitureRenderTarget[] {
    const targets: FurnitureRenderTarget[] = [];

    for (const placement of state.placedFurniture) {
      if (placement.anchorType === 'dock') {
        continue;
      }

      const editor = pickFurnitureEditor(placement);
      if (!editor || editor.document.uri.scheme !== 'file') {
        continue;
      }

      const metrics = collectViewportMetrics(editor, placement.line);
      if (!metrics || !hasViewportRightSafeSpace(metrics)) {
        continue;
      }

      if (placement.anchorType === 'line-bind') {
        if (placement.line < metrics.visibleRange.start.line || placement.line > metrics.visibleRange.end.line) {
          continue;
        }

        const displayLine = clampLine(placement.line, editor.document.lineCount);
        const anchorLine = pickRightEdgeAnchorLine(editor, metrics, displayLine, FURNITURE_MAX_LINE_LENGTH, false);
        if (anchorLine === undefined || !hasInlineFurnitureRoom(editor, displayLine, anchorLine)) {
          continue;
        }

        targets.push({
          placement,
          editor,
          displayLine,
          anchorLine,
          topOffset:
            computeTopOffset(editor, anchorLine, displayLine) +
            Math.round((placement.y - 0.5) * resolveLineHeight(editor) * 0.35),
          marginLeft: computeFurnitureMarginLeft(placement, 'line-bind'),
        });
        continue;
      }

      const viewportDisplayLine = pickViewportFloatLine(metrics, placement.y);
      const viewportAnchorLine = pickRightEdgeAnchorLine(
        editor,
        metrics,
        viewportDisplayLine,
        FURNITURE_MAX_LINE_LENGTH,
        false,
      );
      if (viewportAnchorLine === undefined || !hasInlineFurnitureRoom(editor, viewportDisplayLine, viewportAnchorLine)) {
        continue;
      }

      targets.push({
        placement,
        editor,
        displayLine: viewportDisplayLine,
        anchorLine: viewportAnchorLine,
        topOffset: computeTopOffset(editor, viewportAnchorLine, viewportDisplayLine),
        marginLeft: computeFurnitureMarginLeft(placement, 'viewport-float'),
      });
    }

    return targets;
  }

  private startAnimationLoop(): void {
    if (this.petAnimationTimer) {
      return;
    }

    this.petAnimationTimer = setInterval(() => {
      this.petAnimationTick = (this.petAnimationTick + 1) % 1000;
      this.renderDebounced();
      void this.refreshStateDisplay();
    }, PET_ANIMATION_INTERVAL_MS);
  }

  private getPetAnimationFrame(status: PetStatus): number {
    const profile = getMotionProfile(this.stateStore.getState().petLineage, status);
    return Math.floor(this.petAnimationTick / Math.max(1, profile.frameHold)) % 2;
  }

  private showPetEffect(kind: PetEffectKind, durationMs = 1400): void {
    if (this.petEffectTimer) {
      clearTimeout(this.petEffectTimer);
      this.petEffectTimer = undefined;
    }

    this.petEffect = kind;
    this.petEffectNonce += 1;
    void this.refreshStateDisplay();

    this.petEffectTimer = setTimeout(() => {
      this.petEffect = null;
      this.petEffectTimer = undefined;
      void this.refreshStateDisplay();
    }, durationMs);
  }

  private scheduleFollowupEffect(kind: PetEffectKind, delayMs: number): void {
    if (this.petFollowupEffectTimer) {
      clearTimeout(this.petFollowupEffectTimer);
      this.petFollowupEffectTimer = undefined;
    }

    this.petFollowupEffectTimer = setTimeout(() => {
      this.petFollowupEffectTimer = undefined;
      this.showPetEffect(kind, 1200);
    }, delayMs);
  }

  private ensurePetDecorationsCurrent(): void {
    const state = this.stateStore.getState();
    const stage = getGrowthStage(state.growthPoints);
    const signature = `${state.editorPetScale}:${state.petLineage}:${stage.id}`;
    if (signature === this.currentPetDecorationSignature) {
      return;
    }

    this.rebuildPetDecorationsForState();
  }

  private rebuildPetDecorationsForState(): void {
    const state = this.stateStore.getState();
    const stage = getGrowthStage(state.growthPoints);
    const signature = `${state.editorPetScale}:${state.petLineage}:${stage.id}`;
    for (const decoration of Object.values(this.petDecorations).flat()) {
      decoration.dispose();
    }

    this.currentPetDecorationSignature = signature;
    this.petDecorations = this.createAllPetDecorations(state.editorPetScale);
  }

  private createAllPetDecorations(scale: number): Record<PetMood, readonly vscode.TextEditorDecorationType[]> {
    return {
      normal: this.createPetDecorations('gopher-normal', scale),
      alert: this.createPetDecorations('gopher-alert', scale),
      working: this.createPetDecorations('gopher-working', scale),
    };
  }

  private createPetDecorations(assetPrefix: string, scale: number): readonly vscode.TextEditorDecorationType[] {
    const state = this.stateStore.getState();
    const stage = getGrowthStage(state.growthPoints);
    const iconSize = Math.round((PET_BASE_ICON_SIZE * sanitizePetScale(scale) / 100) * stage.editorScaleMultiplier);
    const opacity = editorPetOpacityForLineage(state.petLineage);
    return [1, 2].map((index) => this.createPetDecoration(
      getPetAssetUri(this.context.extensionUri, state.petLineage, `${assetPrefix}-${index}.svg`),
      iconSize,
      opacity,
    ));
  }

  private createPetDecoration(
    assetUri: vscode.Uri,
    iconSize: number,
    opacity: string,
  ): vscode.TextEditorDecorationType {
    return vscode.window.createTextEditorDecorationType({
      after: {
        contentIconPath: assetUri,
        width: `${iconSize}px`,
        height: `${iconSize}px`,
        margin: `0 0 0 ${PET_FLOAT_OFFSET_X}px`,
      },
      opacity,
      rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
    });
  }

  private createFurnitureDecoration(kind: FurnitureKind): vscode.TextEditorDecorationType {
    const size = FURNITURE_ICON_SIZES[kind];
    return vscode.window.createTextEditorDecorationType({
      after: {
        contentIconPath: vscode.Uri.joinPath(this.context.extensionUri, 'media', 'furniture', 'default', getFurnitureAssetFile(kind)),
        width: `${size}px`,
        height: `${size}px`,
        margin: `0 0 0 ${FURNITURE_BASE_OFFSET_X}px`,
      },
      opacity: FURNITURE_OPACITY,
      rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
    });
  }
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const controller = new EdenController(context);
  context.subscriptions.push(controller);
  await controller.initialize();
}

export function deactivate(): void {}

function getNextGrowthStage(stageId: ReturnType<typeof getGrowthStage>['id']) {
  const stages = [getGrowthStage(0), getGrowthStage(100), getGrowthStage(300)];
  const current = stages.find((stage) => stage.id === stageId);
  if (!current) {
    return undefined;
  }

  return stages.find((stage) => stage.minPoints > current.minPoints);
}

function editorPetOpacityForLineage(lineage: PetLineage): string {
  switch (lineage) {
    case 'concurrency':
      return '0.82';
    case 'protocols':
      return '0.75';
    case 'chaos':
      return '0.84';
    default:
      return '0.78';
  }
}

function mergeFurnitureKinds(
  preferredKinds: readonly FurnitureKind[],
  requestedKinds: readonly FurnitureKind[],
): readonly FurnitureKind[] {
  return Array.from(new Set([...preferredKinds, ...requestedKinds]));
}

function scorePlacementPreference(
  placement: PlacedFurniture,
  preferredKinds: readonly FurnitureKind[],
  activeDocumentUri: string | undefined,
  affinity: 'weak' | 'medium' | 'strong',
): number {
  let score = 0;
  const preferredIndex = preferredKinds.indexOf(placement.kind);
  if (preferredIndex >= 0) {
    score += 80 - preferredIndex * 6;
  }
  if (placement.documentUri && placement.documentUri === activeDocumentUri) {
    score += 28;
  }
  if (placement.anchorType === 'dock') {
    score += affinity === 'strong' ? 22 : 14;
  }
  if (placement.anchorType === 'viewport-float') {
    score += 8;
  }
  if (affinity === 'strong') {
    score += 10;
  }
  return score;
}

function dockOffsetForReason(reason: PetAffinityReason): { x: number; y: number } {
  switch (reason) {
    case 'error':
      return { x: -0.08, y: -0.03 };
    case 'save':
      return { x: 0.06, y: -0.05 };
    case 'interaction':
      return { x: 0.04, y: -0.02 };
    default:
      return { x: -0.04, y: -0.02 };
  }
}

function buildInteractionMessage(lineage: PetLineage, stageId: ReturnType<typeof getGrowthStage>['id']): string {
  if (lineage === 'concurrency') {
    return stageId === 'stage-c' ? '像电流一样绕着你飞快抖了两圈' : '轻快地蹦了蹦尾巴';
  }
  if (lineage === 'protocols') {
    return stageId === 'stage-c' ? '认真地朝你点了点头，又在钢琴边转了一圈' : '安静地向你靠近了一点';
  }
  if (lineage === 'chaos') {
    return stageId === 'stage-c' ? '先夸张地抖了一下，再开心地扑到你身边' : '有点紧张又很开心地蹭了蹭你';
  }
  return stageId === 'stage-c' ? '满足地绕着长椅转了一圈' : '开心地蹭了蹭你';
}

function buildSaveMessage(lineage: PetLineage, stageId: ReturnType<typeof getGrowthStage>['id']): string {
  if (lineage === 'concurrency') {
    return stageId === 'stage-a' ? '保存成功，它只是轻轻闪了一下' : '保存成功，它像小精灵一样飞快庆祝';
  }
  if (lineage === 'protocols') {
    return stageId === 'stage-a' ? '保存成功，它安静地点了点头' : '保存成功，它像小管理员一样认真庆祝了一次';
  }
  if (lineage === 'chaos') {
    return stageId === 'stage-a' ? '保存成功，它先愣了一下才敢开心' : '保存成功，它出现了巨大的反差式庆祝';
  }
  return stageId === 'stage-a' ? '保存成功，小家伙轻轻晃了晃身体' : '保存成功，它在熟悉的角落里开心地跳了跳';
}

function buildErrorMessage(lineage: PetLineage, stageId: ReturnType<typeof getGrowthStage>['id']): string {
  if (stageId === 'stage-a') {
    return '检测到错误，它只是缩了一下身子，还不太会主动找掩体';
  }
  if (lineage === 'concurrency') {
    return '检测到错误，它一下窜到台灯或街机附近躲了起来';
  }
  if (lineage === 'protocols') {
    return '检测到错误，它谨慎地退到钢琴或台灯旁整理状态';
  }
  if (lineage === 'chaos') {
    return '检测到错误，它慌张地寻找树和长椅当掩体';
  }
  return '检测到错误，它会更喜欢缩到长椅和树边静一静';
}

function describeCurrentStatus(
  status: PetStatus,
  lineage: PetLineage,
  stageId: ReturnType<typeof getGrowthStage>['id'],
  hasErrors: boolean,
): string {
  if (hasErrors || status === 'startled') {
    if (lineage === 'protocols') {
      return '谨慎退避中';
    }
    if (lineage === 'chaos') {
      return '戏剧性受惊中';
    }
    return stageId === 'stage-a' ? '受惊僵住中' : '受惊躲避中';
  }

  if (status === 'working') {
    if (lineage === 'concurrency') {
      return '高速编织中';
    }
    if (lineage === 'protocols') {
      return '秩序搭建中';
    }
    if (lineage === 'chaos') {
      return '混沌冲刺中';
    }
    return '认真成长中';
  }

  if (stageId === 'stage-c') {
    return '原住民巡逻中';
  }
  if (stageId === 'stage-b') {
    return '熟悉环境中';
  }
  return '轻轻观察中';
}

function describeCurrentStatusHint(
  status: PetStatus,
  lineage: PetLineage,
  stageId: ReturnType<typeof getGrowthStage>['id'],
  hasErrors: boolean,
): string {
  if (hasErrors || status === 'startled') {
    return buildErrorMessage(lineage, stageId);
  }

  if (status === 'working') {
    if (lineage === 'concurrency') {
      return '这类宠物工作节奏最快，短时间写入较多代码时最容易进入高活跃状态。';
    }
    if (lineage === 'protocols') {
      return '它在结构清晰的工程里最稳，会用更克制的动作保持专注。';
    }
    if (lineage === 'chaos') {
      return '它会用更明显的抖动和节奏差来表达“现在真的很忙”。';
    }
    return '它会用更圆润的动作告诉你：这段时间的代码写得很顺。';
  }

  if (stageId === 'stage-a') {
    return '继续写代码、保存成功、逗它一下，都能帮助它从初生期长大。';
  }
  if (stageId === 'stage-b') {
    return '现在它会开始明显回应家具和环境，写代码的每次正反馈都会更有存在感。';
  }
  return '它已经进入成熟期，是这个项目真正的常住居民，下一步就可以承接更复杂的进化分支。';
}

function clearPetDecorations(
  editor: vscode.TextEditor,
  petDecorations: Record<PetMood, readonly vscode.TextEditorDecorationType[]>,
): void {
  const empty: vscode.DecorationOptions[] = [];
  for (const frames of Object.values(petDecorations)) {
    for (const decoration of frames) {
      editor.setDecorations(decoration, empty);
    }
  }
}

function clearFurnitureDecorations(
  editor: vscode.TextEditor,
  furnitureDecorations: Record<FurnitureKind, vscode.TextEditorDecorationType>,
): void {
  const empty: vscode.DecorationOptions[] = [];
  for (const decoration of Object.values(furnitureDecorations)) {
    editor.setDecorations(decoration, empty);
  }
}

const EXCLUDED_RESOURCE_EXTENSIONS = new Set([
  '.7z',
  '.avi',
  '.bin',
  '.bmp',
  '.class',
  '.dll',
  '.dmg',
  '.exe',
  '.gif',
  '.gz',
  '.ico',
  '.jar',
  '.jpeg',
  '.jpg',
  '.mov',
  '.mp3',
  '.mp4',
  '.o',
  '.obj',
  '.pdf',
  '.png',
  '.pyc',
  '.rar',
  '.so',
  '.tar',
  '.tgz',
  '.ttf',
  '.vsix',
  '.wav',
  '.webm',
  '.woff',
  '.woff2',
  '.zip',
]);

const EXCLUDED_RESOURCE_BASENAMES = new Set([
  '.gitignore',
  '.gitattributes',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
]);

const EXCLUDED_RESOURCE_LANGUAGE_IDS = new Set([
  'git-commit',
  'git-rebase',
  'log',
  'output',
  'search-result',
]);

interface GitIgnoreRule {
  readonly negate: boolean;
  readonly matcher: RegExp;
}

interface GitIgnoreCacheEntry {
  readonly stamp: string;
  readonly rules: readonly GitIgnoreRule[];
}

const gitIgnoreCache = new Map<string, GitIgnoreCacheEntry>();

async function isResourceTrackedDocument(document: vscode.TextDocument): Promise<boolean> {
  if (document.uri.scheme !== 'file') {
    return false;
  }

  const languageId = document.languageId.toLowerCase();
  if (EXCLUDED_RESOURCE_LANGUAGE_IDS.has(languageId)) {
    return false;
  }

  const filePath = document.uri.fsPath.toLowerCase();
  const baseName = pathBaseName(filePath);
  if (EXCLUDED_RESOURCE_BASENAMES.has(baseName)) {
    return false;
  }

  const extension = pathExtension(baseName);
  if (EXCLUDED_RESOURCE_EXTENSIONS.has(extension)) {
    return false;
  }

  const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
  if (workspaceFolder && await isGitIgnored(document.uri, workspaceFolder)) {
    return false;
  }

  return true;
}

async function isGitIgnored(uri: vscode.Uri, workspaceFolder: vscode.WorkspaceFolder): Promise<boolean> {
  const relativePath = toWorkspaceRelativePath(uri, workspaceFolder);
  if (!relativePath) {
    return false;
  }

  const rules = await loadGitIgnoreRules(workspaceFolder);
  let ignored = false;

  for (const rule of rules) {
    if (rule.matcher.test(relativePath)) {
      ignored = !rule.negate;
    }
  }

  return ignored;
}

async function loadGitIgnoreRules(workspaceFolder: vscode.WorkspaceFolder): Promise<readonly GitIgnoreRule[]> {
  const cacheKey = workspaceFolder.uri.toString();
  const gitIgnoreUri = vscode.Uri.joinPath(workspaceFolder.uri, '.gitignore');

  try {
    const stat = await vscode.workspace.fs.stat(gitIgnoreUri);
    const stamp = `${stat.mtime}:${stat.size}`;
    const cached = gitIgnoreCache.get(cacheKey);
    if (cached?.stamp === stamp) {
      return cached.rules;
    }

    const content = Buffer.from(await vscode.workspace.fs.readFile(gitIgnoreUri)).toString('utf8');
    const rules = parseGitIgnoreRules(content);
    gitIgnoreCache.set(cacheKey, { stamp, rules });
    return rules;
  } catch {
    const cached = gitIgnoreCache.get(cacheKey);
    if (cached?.stamp === 'missing') {
      return cached.rules;
    }

    gitIgnoreCache.set(cacheKey, { stamp: 'missing', rules: [] });
    return [];
  }
}

function parseGitIgnoreRules(content: string): readonly GitIgnoreRule[] {
  const rules: GitIgnoreRule[] = [];

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    let pattern = line;
    let negate = false;
    if (pattern.startsWith('!')) {
      negate = true;
      pattern = pattern.slice(1);
    }

    pattern = pattern.replace(/\\/g, '/');
    const anchored = pattern.startsWith('/');
    if (anchored) {
      pattern = pattern.slice(1);
    }

    if (!pattern) {
      continue;
    }

    const directoryOnly = pattern.endsWith('/');
    if (directoryOnly) {
      pattern = pattern.slice(0, -1);
    }

    if (!pattern) {
      continue;
    }

    rules.push({
      negate,
      matcher: compileGitIgnorePattern(pattern, anchored, directoryOnly),
    });
  }

  return rules;
}

function compileGitIgnorePattern(pattern: string, anchored: boolean, directoryOnly: boolean): RegExp {
  const normalized = pattern.replace(/\\/g, '/');
  const prefix = anchored ? '^' : '(?:^|.*/)';
  const body = globToRegExpSource(normalized);
  const suffix = directoryOnly ? '(?:$|/.*)' : '(?:$|/.*)';
  return new RegExp(`${prefix}${body}${suffix}`);
}

function globToRegExpSource(pattern: string): string {
  let source = '';

  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    if (char === '*') {
      if (pattern[index + 1] === '*') {
        source += '.*';
        index += 1;
      } else {
        source += '[^/]*';
      }
      continue;
    }

    if (char === '?') {
      source += '[^/]';
      continue;
    }

    source += escapeRegExpChar(char);
  }

  return source;
}

function escapeRegExpChar(char: string): string {
  return /[|\\{}()[\]^$+?.]/.test(char) ? `\\${char}` : char;
}

function toWorkspaceRelativePath(uri: vscode.Uri, workspaceFolder: vscode.WorkspaceFolder): string | undefined {
  const workspacePath = workspaceFolder.uri.fsPath.replace(/\\/g, '/');
  const filePath = uri.fsPath.replace(/\\/g, '/');
  if (!filePath.toLowerCase().startsWith(workspacePath.toLowerCase())) {
    return undefined;
  }

  return filePath.slice(workspacePath.length).replace(/^\/+/, '');
}

function pathBaseName(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  const lastSlash = normalized.lastIndexOf('/');
  return lastSlash >= 0 ? normalized.slice(lastSlash + 1) : normalized;
}

function pathExtension(baseName: string): string {
  const lastDot = baseName.lastIndexOf('.');
  return lastDot > 0 ? baseName.slice(lastDot) : '';
}

function countMeaningfulLines(text: string): number {
  if (!text.trim()) {
    return 0;
  }

  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0).length;
}

function countRemovedLines(range: vscode.Range): number {
  if (range.isEmpty) {
    return 0;
  }

  if (range.isSingleLine) {
    return 1;
  }

  return range.end.line - range.start.line + 1;
}

function endOfLineRange(document: vscode.TextDocument, line: number): vscode.Range {
  const safeLine = clampLine(line, document.lineCount);
  const lineText = document.lineAt(safeLine);
  return new vscode.Range(lineText.range.end, lineText.range.end);
}

function clampLine(line: number, lineCount: number): number {
  if (lineCount <= 0) {
    return 0;
  }

  return Math.min(Math.max(0, line), lineCount - 1);
}

function pickFurnitureEditor(placement: PlacedFurniture): vscode.TextEditor | undefined {
  return vscode.window.visibleTextEditors.find(
    (editor) => editor.document.uri.toString() === placement.documentUri,
  );
}

function collectViewportMetrics(
  editor: vscode.TextEditor,
  preferredLine: number,
): ViewportMetrics | undefined {
  const visibleRange = pickVisibleRange(editor, preferredLine);
  if (!visibleRange) {
    return undefined;
  }

  const lengths: number[] = [];
  let shortLineCount = 0;
  let mediumLineCount = 0;

  for (let line = visibleRange.start.line; line <= visibleRange.end.line; line += 1) {
    const length = editor.document.lineAt(line).text.trimEnd().length;
    lengths.push(length);
    if (length <= 40) {
      shortLineCount += 1;
    }
    if (length <= 72) {
      mediumLineCount += 1;
    }
  }

  if (lengths.length === 0) {
    return undefined;
  }

  const sortedLengths = [...lengths].sort((left, right) => left - right);
  const totalLength = lengths.reduce((sum, length) => sum + length, 0);

  return {
    visibleRange,
    lengths,
    sortedLengths,
    averageLength: totalLength / lengths.length,
    medianLength: percentile(sortedLengths, 0.5),
    p70Length: percentile(sortedLengths, 0.7),
    p80Length: percentile(sortedLengths, 0.8),
    p90Length: percentile(sortedLengths, 0.9),
    shortLineCount,
    mediumLineCount,
  };
}

function percentile(sorted: readonly number[], ratio: number): number {
  if (sorted.length === 0) {
    return 0;
  }

  const index = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * ratio)));
  return sorted[index];
}

function hasViewportRightSafeSpace(metrics: ViewportMetrics): boolean {
  const totalLines = metrics.lengths.length;
  const shortLineRatio = metrics.shortLineCount / totalLines;
  const mediumLineRatio = metrics.mediumLineCount / totalLines;

  if (metrics.p90Length >= 120 && metrics.averageLength >= 78 && mediumLineRatio < 0.24) {
    return false;
  }

  if (metrics.p80Length >= 104 && metrics.averageLength >= 68 && shortLineRatio < 0.14) {
    return false;
  }

  return true;
}

function pickFloatingLine(
  editor: vscode.TextEditor,
  metrics: ViewportMetrics,
  preferredLine: number,
): number | undefined {
  const activeLine = editor.selection.active.line;
  const idealLine = preferredFloatingLine(editor, metrics.visibleRange, preferredLine);
  const searchOffsets = [0, 1, -1, 2, -2, 3, -3, 4, -4, 5, -5, 6, -6, 7, -7];
  const tiers = [
    (line: number) => line !== activeLine && editor.document.lineAt(line).text.trim().length === 0,
    (line: number) => line !== activeLine && editor.document.lineAt(line).text.trimEnd().length <= 16,
    (line: number) => line !== activeLine && editor.document.lineAt(line).text.trimEnd().length <= 28,
    (line: number) => line !== activeLine && editor.document.lineAt(line).text.trimEnd().length <= PET_MAX_FLOAT_LINE_LENGTH,
  ];

  for (const matches of tiers) {
    for (const offset of searchOffsets) {
      const candidate = idealLine + offset;
      if (candidate < metrics.visibleRange.start.line || candidate > metrics.visibleRange.end.line) {
        continue;
      }

      if (matches(candidate)) {
        return candidate;
      }
    }
  }

  return undefined;
}

function preferredFloatingLine(
  editor: vscode.TextEditor,
  visibleRange: vscode.Range,
  preferredLine: number,
): number {
  const activeLine = editor.selection.active.line;
  const currentLineLength = editor.document
    .lineAt(clampLine(activeLine, editor.document.lineCount))
    .text.trimEnd().length;
  const nearRightEdge =
    activeLine >= visibleRange.start.line &&
    activeLine <= visibleRange.end.line &&
    Math.max(editor.selection.active.character, currentLineLength) >= 72;

  const baseLine =
    preferredLine >= visibleRange.start.line && preferredLine <= visibleRange.end.line
      ? preferredLine
      : visibleRange.start.line + Math.floor((visibleRange.end.line - visibleRange.start.line) * 0.38);

  const shiftedLine = nearRightEdge ? baseLine + 2 : baseLine + 1;
  const minLine = visibleRange.start.line + 1;
  const maxLine = Math.max(minLine, visibleRange.end.line - 2);
  return Math.min(Math.max(shiftedLine, minLine), maxLine);
}

function pickDockDisplayLine(
  editor: vscode.TextEditor,
  metrics: ViewportMetrics,
): number | undefined {
  const startLine = Math.max(metrics.visibleRange.start.line, metrics.visibleRange.end.line - 5);
  const activeLine = editor.selection.active.line;

  for (let line = metrics.visibleRange.end.line; line >= startLine; line -= 1) {
    const length = editor.document.lineAt(line).text.trimEnd().length;
    if (line === activeLine) {
      continue;
    }
    if (length <= PET_MAX_EDGE_LINE_LENGTH) {
      return line;
    }
  }

  return undefined;
}

function pickRightEdgeAnchorLine(
  editor: vscode.TextEditor,
  metrics: ViewportMetrics,
  displayLine: number,
  maxLength: number,
  preferBottomHalf: boolean,
): number | undefined {
  const viewportHeight = metrics.visibleRange.end.line - metrics.visibleRange.start.line + 1;
  const minLine = preferBottomHalf
    ? metrics.visibleRange.start.line + Math.floor(viewportHeight * 0.35)
    : metrics.visibleRange.start.line;

  let bestLine: number | undefined;
  let bestScore = Number.POSITIVE_INFINITY;

  for (let line = metrics.visibleRange.end.line; line >= minLine; line -= 1) {
    const length = editor.document.lineAt(line).text.trimEnd().length;
    if (length > maxLength) {
      continue;
    }

    const rightBias = -length * 2.4;
    const distancePenalty = Math.abs(line - displayLine) * (preferBottomHalf ? 0.35 : 0.18);
    const blankPenalty = length === 0 ? 22 : 0;
    const score = rightBias + distancePenalty + blankPenalty;

    if (score < bestScore) {
      bestScore = score;
      bestLine = line;
    }
  }

  return bestLine;
}

function pickViewportFloatLine(metrics: ViewportMetrics, y: number): number {
  const viewportHeight = metrics.visibleRange.end.line - metrics.visibleRange.start.line;
  const preferred = metrics.visibleRange.start.line + Math.round(viewportHeight * clampNumber(y, 0.18, 0.84));
  return clampLine(preferred, metrics.visibleRange.end.line + 1);
}

function dockEdgeTopOffset(editor: vscode.TextEditor): number {
  const lineHeight = resolveLineHeight(editor);
  return Math.max(2, Math.round(lineHeight * 0.18));
}

function pickVisibleRange(editor: vscode.TextEditor, line: number): vscode.Range | undefined {
  return (
    editor.visibleRanges.find((range) => line >= range.start.line && line <= range.end.line) ??
    editor.visibleRanges[0]
  );
}

function resolveLineHeight(editor: vscode.TextEditor): number {
  const configuredLineHeight = vscode.workspace
    .getConfiguration('editor', editor.document.uri)
    .get<number>('lineHeight', 20);
  return configuredLineHeight > 0 ? configuredLineHeight : 20;
}

function computeTopOffset(editor: vscode.TextEditor, anchorLine: number, displayLine: number): number {
  return (displayLine - anchorLine) * resolveLineHeight(editor);
}

function hasInlinePetRoom(
  editor: vscode.TextEditor,
  displayLine: number,
  anchorLine: number,
  mode: PetRenderMode,
): boolean {
  const displayLength = editor.document.lineAt(displayLine).text.trimEnd().length;
  const anchorLength = editor.document.lineAt(anchorLine).text.trimEnd().length;

  if (anchorLength >= PET_MAX_ANCHOR_LENGTH) {
    return false;
  }

  if (mode === 'dock-edge') {
    return displayLength < PET_MAX_EDGE_LINE_LENGTH;
  }

  return displayLength < PET_MAX_FLOAT_LINE_LENGTH;
}

function hasInlineFurnitureRoom(
  editor: vscode.TextEditor,
  displayLine: number,
  anchorLine: number,
): boolean {
  const displayLength = editor.document.lineAt(displayLine).text.trimEnd().length;
  const anchorLength = editor.document.lineAt(anchorLine).text.trimEnd().length;
  return displayLength < FURNITURE_MAX_LINE_LENGTH && anchorLength < FURNITURE_MAX_LINE_LENGTH;
}

function buildOverlayCss(topOffset: number): string {
  return [
    'none',
    'position: relative',
    `top: ${topOffset}px`,
    'pointer-events: none',
    'z-index: 10',
    'vertical-align: top',
  ].join('; ');
}

function computeFurnitureMarginLeft(
  placement: PlacedFurniture,
  anchorType: Exclude<FurnitureAnchorType, 'dock'>,
): number {
  const base = anchorType === 'viewport-float' ? FURNITURE_FLOAT_OFFSET_X : FURNITURE_BASE_OFFSET_X;
  return Math.round(base + clampNumber(placement.x, 0.04, 0.96) * 42);
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function sanitizePetScale(value: number): number {
  return Math.round(clampNumber(value, PET_SCALE_MIN, PET_SCALE_MAX) / 10) * 10;
}

function toEditorPetUiState(
  state: EdenState,
  target: PetRenderTarget,
  dockVisible: boolean,
): EditorPetUiState {
  if (!state.editorPetEnabled) {
    return {
      enabled: false,
      actuallyVisible: false,
      toggleLabel: '\u5728\u4ee3\u7801\u533a\u663e\u793a\u5ba0\u7269',
      statusText: '\u4ee3\u7801\u533a\u5ba0\u7269\u5df2\u5173\u95ed\u3002\u4f60\u53ef\u4ee5\u968f\u65f6\u91cd\u65b0\u6253\u5f00\u3002',
    };
  }

  if (target.reason === 'visible' && target.mode === 'dock-edge') {
    return {
      enabled: true,
      actuallyVisible: true,
      toggleLabel: '\u9690\u85cf\u4ee3\u7801\u533a\u5ba0\u7269',
      statusText: '\u5e95\u90e8\u4e50\u56ed\u5df2\u6253\u5f00\uff0c\u5ba0\u7269\u6b63\u5728\u8d34\u7740\u9762\u677f\u4e0a\u8fb9\u7f18\u966a\u4f60\u5199\u4ee3\u7801\u3002',
    };
  }

  if (target.reason === 'visible') {
    return {
      enabled: true,
      actuallyVisible: true,
      toggleLabel: '\u9690\u85cf\u4ee3\u7801\u533a\u5ba0\u7269',
      statusText: '\u4ee3\u7801\u533a\u5ba0\u7269\u5df2\u5f00\u542f\uff0c\u5f53\u524d\u4f1a\u4f18\u5148\u663e\u793a\u5728\u89c6\u53e3\u53f3\u4fa7\u7684\u5b89\u5168\u7a7a\u767d\u533a\u3002',
    };
  }

  if (dockVisible || target.mode === 'dock-edge') {
    return {
      enabled: true,
      actuallyVisible: false,
      toggleLabel: '\u9690\u85cf\u4ee3\u7801\u533a\u5ba0\u7269',
      statusText: '\u5e95\u90e8\u4e50\u56ed\u5df2\u6253\u5f00\uff0c\u4f46\u5f53\u524d\u5e95\u8fb9\u53f3\u4fa7\u5b89\u5168\u7a7a\u95f4\u4e0d\u591f\uff0c\u6240\u4ee5\u5ba0\u7269\u6682\u65f6\u4e0d\u63a2\u5934\u3002',
    };
  }

  if (target.reason === 'layout') {
    return {
      enabled: true,
      actuallyVisible: false,
      toggleLabel: '\u9690\u85cf\u4ee3\u7801\u533a\u5ba0\u7269',
      statusText: '\u4ee3\u7801\u533a\u5ba0\u7269\u5df2\u5f00\u542f\uff0c\u4f46\u5f53\u524d\u89c6\u53e3\u53f3\u4fa7\u6ca1\u6709\u8db3\u591f\u5b89\u5168\u7a7a\u767d\uff0c\u4e3a\u907f\u514d\u6321\u4f4f\u4ee3\u7801\u6682\u65f6\u9690\u85cf\u3002',
    };
  }

  return {
    enabled: true,
    actuallyVisible: false,
    toggleLabel: '\u9690\u85cf\u4ee3\u7801\u533a\u5ba0\u7269',
    statusText: '\u4ee3\u7801\u533a\u5ba0\u7269\u5df2\u5f00\u542f\uff0c\u5207\u6362\u5230\u53ef\u663e\u793a\u7684\u672c\u5730\u6587\u4ef6\u7f16\u8f91\u5668\u540e\u4f1a\u5c1d\u8bd5\u51fa\u73b0\u3002',
  };
}

function toPetMood(status: PetStatus): PetMood {
  if (status === 'startled') {
    return 'alert';
  }

  if (status === 'working') {
    return 'working';
  }

  return 'normal';
}

function formatAnchorType(anchorType: FurnitureAnchorType): string {
  if (anchorType === 'dock') {
    return '\u5e95\u90e8\u4e50\u56ed';
  }

  if (anchorType === 'viewport-float') {
    return '\u4ee3\u7801\u533a\u6d6e\u5c42';
  }

  return '\u8ddf\u884c\u6446\u653e';
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '\u53d1\u751f\u4e86\u4e00\u4e2a\u672a\u77e5\u9519\u8bef\u3002';
}
