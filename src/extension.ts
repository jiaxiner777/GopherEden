import * as vscode from 'vscode';

import { SHOP_ITEMS } from './catalog';
import { debounce } from './debounce';
import { DockMessage, EdenDockProvider } from './dockProvider';
import { getFurnitureAssetFile, getFurnitureLabel } from './furniture';
import { EdenSidebarProvider, SidebarMessage } from './sidebarProvider';
import { EdenStateStore } from './stateStore';
import {
  EdenState,
  EdenViewState,
  EditorPetUiState,
  FurnitureAnchorType,
  FurnitureKind,
  PetEffectKind,
  PetStatus,
  PlacedFurniture,
} from './types';

type PetMood = 'normal' | 'alert' | 'working';
type PetRenderMode = 'floating' | 'dock-edge';
type PetRenderReason = 'visible' | 'disabled' | 'no-editor' | 'layout';

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
const PET_ANIMATION_INTERVAL_MS = 650;

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
  private readonly furnitureDecorations: Record<FurnitureKind, vscode.TextEditorDecorationType>;
  private readonly statusBarItem: vscode.StatusBarItem;

  private workingAnimationTimer: NodeJS.Timeout | undefined;
  private petAnimationTimer: NodeJS.Timeout | undefined;
  private petEffectTimer: NodeJS.Timeout | undefined;
  private petAnimationTick = 0;
  private petEffect: PetEffectKind | null = null;
  private petEffectNonce = 0;
  private hasErrors = false;
  private activityWindow: ActivityWindowEntry[] = [];
  private dockVisible = false;

  public constructor(private readonly context: vscode.ExtensionContext) {
    this.stateStore = new EdenStateStore(context);
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
    this.rebuildPetDecorations(this.stateStore.getState().editorPetScale);

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
      title: '\u7ed9\u5ba0\u7269\u8d77\u540d',
      prompt: '\u8f93\u5165\u4e00\u4e2a\u4f60\u559c\u6b22\u7684\u540d\u5b57\uff0c\u5b83\u4f1a\u663e\u793a\u5728\u4fa7\u8fb9\u680f\u548c\u5e95\u90e8\u4e50\u56ed\u91cc\u3002',
      value: currentName,
      validateInput: (value) =>
        value.trim().length === 0 ? '\u540d\u5b57\u4e0d\u80fd\u4e3a\u7a7a\u3002' : undefined,
    });

    if (!nextName) {
      return;
    }

    await this.stateStore.update({ petName: nextName.trim() });
    await this.renderAndSync();
  }

  private async playWithPet(): Promise<void> {
    const petName = this.stateStore.getState().petName;
    this.showPetEffect('heart');
    void vscode.window.setStatusBarMessage(`${petName} 开心地晃了晃。`, 2200);
    await this.refreshStateDisplay();
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
    this.rebuildPetDecorations(nextScale);
    await this.renderAndSync();
  }

  private async buyItem(kind: FurnitureKind): Promise<void> {
    try {
      await this.stateStore.purchaseItem(kind);
      const item = SHOP_ITEMS.find((entry) => entry.kind === kind);
      if (item) {
        this.showPetEffect('sparkle');
        void vscode.window.setStatusBarMessage(`已购买 ${item.name}，已放入背包。`, 2600);
      }
      await this.renderAndSync();
    } catch (error) {
      await vscode.window.showWarningMessage(toErrorMessage(error));
    }
  }

  private async placeFurniture(
    kind: FurnitureKind,
    anchorType: FurnitureAnchorType,
  ): Promise<void> {
    try {
      if (anchorType === 'dock') {
        await this.stateStore.placeFurnitureInDock(kind);
        await this.renderAndSync();
        await this.openDock();
        return;
      }

      const editor = this.getPlaceableEditor();
      if (!editor) {
        await vscode.window.showWarningMessage('\u8bf7\u5148\u6253\u5f00\u4e00\u4e2a\u672c\u5730\u6587\u4ef6\uff0c\u518d\u628a\u5bb6\u5177\u6446\u5230\u4ee3\u7801\u533a\u3002');
        return;
      }

      await this.stateStore.placeFurnitureInEditor(
        kind,
        anchorType,
        editor.document.uri.toString(),
        editor.selection.active.line,
      );
      await this.stateStore.setPetAnchor(editor.document.uri.toString(), editor.selection.active.line);
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
            await vscode.window.showWarningMessage('\u6ca1\u6709\u53ef\u7528\u7684\u6587\u4ef6\u7f16\u8f91\u5668\uff0c\u65e0\u6cd5\u5207\u56de\u8ddf\u884c\u6a21\u5f0f\u3002');
            return;
          }

          await this.stateStore.changePlacementAnchor(id, 'line-bind', context);
          break;
        }
        case 'to-viewport-float': {
          const context = this.resolvePlacementEditorContext(placement);
          if (!context) {
            await vscode.window.showWarningMessage('\u6ca1\u6709\u53ef\u7528\u7684\u6587\u4ef6\u7f16\u8f91\u5668\uff0c\u65e0\u6cd5\u5207\u56de\u6d6e\u5c42\u6a21\u5f0f\u3002');
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
      void vscode.window.setStatusBarMessage('\u5f53\u524d\u6ca1\u6709\u5df2\u6446\u653e\u5bb6\u5177\u9700\u8981\u6536\u56de\u3002', 2200);
      return;
    }

    await this.stateStore.returnAllPlacementsToInventory();
    await this.renderAndSync();
    void vscode.window.setStatusBarMessage(`\u5df2\u5c06 ${placedCount} \u4e2a\u6446\u4ef6\u5168\u90e8\u6536\u56de\u80cc\u5305\u3002`, 2800);
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
      .filter((entry) => now - entry.at <= 2000)
      .concat({ at: now, addedLines: addedMeaningfulLines });

    const totalRecentLines = this.activityWindow.reduce((sum, entry) => sum + entry.addedLines, 0);
    if (totalRecentLines < 20) {
      return;
    }

    if (this.workingAnimationTimer) {
      clearTimeout(this.workingAnimationTimer);
    }

    void this.setComputedStatus('working');
    this.workingAnimationTimer = setTimeout(() => {
      this.workingAnimationTimer = undefined;
      void this.refreshComputedStatus();
    }, 6000);
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
      this.showPetEffect('alert');
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

  private buildViewState(): EdenViewState {
    const state = this.stateStore.getState();
    const target = this.resolvePetRenderTarget(state);
    return {
      state,
      editorPet: toEditorPetUiState(state, target, this.dockVisible),
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
      const activeDecoration = this.petDecorations[petMood][this.getPetAnimationFrame(state.petStatus)] ?? this.petDecorations[petMood][0];
      const topOffset = computeTopOffset(petTarget.editor, petTarget.anchorLine, petTarget.displayLine) + (petTarget.topOffset ?? 0);

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
        hoverMessage: `${getFurnitureLabel(target.placement.kind)} ? ${formatAnchorType(target.placement.anchorType)}`,
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
        if (
          placement.line < metrics.visibleRange.start.line ||
          placement.line > metrics.visibleRange.end.line
        ) {
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
    if (status === 'normal') {
      return Math.floor(this.petAnimationTick / 2) % 2;
    }

    return this.petAnimationTick % 2;
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

  private rebuildPetDecorations(scale: number): void {
    for (const decoration of Object.values(this.petDecorations).flat()) {
      decoration.dispose();
    }

    this.petDecorations = this.createAllPetDecorations(scale);
  }

  private createAllPetDecorations(scale: number): Record<PetMood, readonly vscode.TextEditorDecorationType[]> {
    return {
      normal: this.createPetDecorations('gopher-normal', scale),
      alert: this.createPetDecorations('gopher-alert', scale),
      working: this.createPetDecorations('gopher-working', scale),
    };
  }

  private createPetDecorations(assetPrefix: string, scale: number): readonly vscode.TextEditorDecorationType[] {
    const iconSize = Math.round((PET_BASE_ICON_SIZE * sanitizePetScale(scale)) / 100);
    return [1, 2].map((index) => this.createPetDecoration(
      vscode.Uri.joinPath(this.context.extensionUri, 'media', `${assetPrefix}-${index}.svg`),
      iconSize,
    ));
  }

  private createPetDecoration(assetUri: vscode.Uri, iconSize: number): vscode.TextEditorDecorationType {
    return vscode.window.createTextEditorDecorationType({
      after: {
        contentIconPath: assetUri,
        width: `${iconSize}px`,
        height: `${iconSize}px`,
        margin: `0 0 0 ${PET_FLOAT_OFFSET_X}px`,
      },
      opacity: '0.76',
      rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
    });
  }

  private createFurnitureDecoration(kind: FurnitureKind): vscode.TextEditorDecorationType {
    const size = FURNITURE_ICON_SIZES[kind];
    return vscode.window.createTextEditorDecorationType({
      after: {
        contentIconPath: vscode.Uri.joinPath(this.context.extensionUri, 'media', getFurnitureAssetFile(kind)),
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
