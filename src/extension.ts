import * as vscode from 'vscode';

import { debounce } from './debounce';
import { DockMessage, EdenDockProvider } from './dockProvider';
import { EdenSidebarProvider, SidebarMessage } from './sidebarProvider';
import { EdenStateStore } from './stateStore';
import { EdenState, EdenViewState, EditorPetUiState, PetStatus } from './types';

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

const PET_ICON_SIZE = 24;
const PET_FLOAT_OFFSET_X = 96;
const PET_EDGE_OFFSET_X = 72;
const PET_MAX_ANCHOR_LENGTH = 132;
const PET_MAX_FLOAT_LINE_LENGTH = 116;
const PET_MAX_EDGE_LINE_LENGTH = 92;

class EdenController implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private readonly renderDebounced: () => void;
  private readonly stateStore: EdenStateStore;
  private readonly sidebarProvider: EdenSidebarProvider;
  private readonly dockProvider: EdenDockProvider;
  private readonly petDecorations: Record<PetMood, vscode.TextEditorDecorationType>;
  private readonly statusBarItem: vscode.StatusBarItem;

  private workingAnimationTimer: NodeJS.Timeout | undefined;
  private hasErrors = false;
  private activityWindow: ActivityWindowEntry[] = [];
  private dockVisible = false;

  public constructor(private readonly context: vscode.ExtensionContext) {
    this.stateStore = new EdenStateStore(context.globalState);
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

    this.petDecorations = {
      normal: this.createPetDecoration(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'gopher-normal.svg')),
      alert: this.createPetDecoration(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'gopher-alert.svg')),
      working: this.createPetDecoration(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'gopher-working.svg')),
    };
    this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    this.statusBarItem.text = '$(symbol-misc) Gopher \u5e95\u90e8\u4e50\u56ed';
    this.statusBarItem.tooltip = 'Gopher \u7684\u62d6\u62fd\u4e0e\u4e92\u52a8\u5728\u5e95\u90e8\u4e50\u56ed\u4e2d\u8fdb\u884c';
    this.statusBarItem.command = 'gophersEden.openDock';

    this.disposables.push(...Object.values(this.petDecorations), this.statusBarItem);
  }

  public async initialize(): Promise<void> {
    this.disposables.push(this.registerSidebar());
    this.disposables.push(this.registerDock());
    this.disposables.push(this.registerCommands());
    this.disposables.push(this.registerEventListeners());
    this.statusBarItem.show();

    const activeEditor = vscode.window.activeTextEditor;
    if (activeEditor) {
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
      vscode.commands.registerCommand('gophersEden.placePiano', async () => {
        await this.placePiano();
      }),
      vscode.commands.registerCommand('gophersEden.switchTheme', async (theme?: string) => {
        if (theme === 'cyber-oasis' || theme === 'pixel-meadow') {
          await this.stateStore.setTheme(theme);
          await this.renderAndSync();
        }
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
    if (message.type === 'ready') {
      await this.refreshStateDisplay();
      return;
    }

    if (message.type === 'openDock') {
      await this.openDock();
      return;
    }

    if (message.type === 'renamePet') {
      await this.renamePet();
      return;
    }

    if (message.type === 'placePiano') {
      await this.placePiano();
      return;
    }

    if (message.type === 'toggleEditorPet') {
      await this.toggleEditorPet();
      return;
    }

    if (message.type === 'setTheme') {
      await this.stateStore.setTheme(message.theme);
      await this.renderAndSync();
    }
  }

  private async handleDockMessage(message: DockMessage): Promise<void> {
    if (message.type === 'ready') {
      await this.refreshStateDisplay();
      return;
    }

    if (message.type === 'renamePet') {
      await this.renamePet();
      return;
    }

    if (message.type === 'placePiano') {
      await this.placePiano();
      return;
    }

    if (message.type === 'toggleEditorPet') {
      await this.toggleEditorPet();
      return;
    }

    if (message.type === 'movePet') {
      await this.stateStore.setPetDockPosition({ x: message.x, y: message.y });
      await this.refreshStateDisplay();
      this.renderDebounced();
      return;
    }

    if (message.type === 'moveFurniture') {
      await this.stateStore.movePlacement(message.id, { x: message.x, y: message.y });
      await this.refreshStateDisplay();
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
      prompt: '\u8f93\u5165\u4e00\u4e2a\u4f60\u559c\u6b22\u7684\u540d\u5b57\uff0c\u5b83\u4f1a\u663e\u793a\u5728\u5ba0\u7269\u5934\u9876\u3002',
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

  private async toggleEditorPet(): Promise<void> {
    const current = this.stateStore.getState();
    await this.stateStore.setEditorPetEnabled(!current.editorPetEnabled);
    await this.renderAndSync();
  }

  private async placePiano(): Promise<void> {
    await this.stateStore.addPiano();
    await this.refreshStateDisplay();
    await this.openDock();
  }

  private async handleTextDocumentChange(event: vscode.TextDocumentChangeEvent): Promise<void> {
    if (event.document.uri.scheme !== 'file') {
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

    if (matchingEditor) {
      await this.stateStore.setPetAnchor(
        matchingEditor.document.uri.toString(),
        matchingEditor.selection.active.line,
      );
    }

    this.renderDebounced();
  }

  private async handleSelectionChange(event: vscode.TextEditorSelectionChangeEvent): Promise<void> {
    await this.stateStore.setPetAnchor(
      event.textEditor.document.uri.toString(),
      event.selections[0]?.active.line ?? 0,
    );
    this.renderDebounced();
  }

  private async handleActiveEditorChange(editor: vscode.TextEditor | undefined): Promise<void> {
    if (!editor) {
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
      void vscode.window.showInformationMessage(`Gopher \u6536\u96c6\u5230\u4e86 ${earned} \u5757\u788e\u7816\u3002`);
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

    this.hasErrors = errorCount > 0;
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
    const target = this.resolvePetRenderTarget(state);
    const petMood = toPetMood(state.petStatus);

    for (const editor of vscode.window.visibleTextEditors) {
      clearPetDecorations(editor, this.petDecorations);
    }

    if (
      target.reason !== 'visible' ||
      !target.editor ||
      target.displayLine === undefined ||
      target.anchorLine === undefined
    ) {
      return;
    }

    const anchorRange = endOfLineRange(target.editor.document, target.anchorLine);
    const activeDecoration = this.petDecorations[petMood];
    const topOffset = computeTopOffset(target.editor, target.anchorLine, target.displayLine) + (target.topOffset ?? 0);

    target.editor.setDecorations(activeDecoration, [
      {
        range: anchorRange,
        renderOptions: {
          after: {
            margin: `0 0 0 ${target.mode === 'dock-edge' ? PET_EDGE_OFFSET_X : PET_FLOAT_OFFSET_X}px`,
            textDecoration: buildPetLayerCss(topOffset),
          },
        },
      },
    ]);
  }

  private resolvePetRenderTarget(state: EdenState): PetRenderTarget {
    if (!state.editorPetEnabled) {
      return { reason: 'disabled' };
    }

    const editor = pickPetEditor(state);
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

  private createPetDecoration(assetUri: vscode.Uri): vscode.TextEditorDecorationType {
    return vscode.window.createTextEditorDecorationType({
      after: {
        contentIconPath: assetUri,
        width: `${PET_ICON_SIZE}px`,
        height: `${PET_ICON_SIZE}px`,
        margin: `0 0 0 ${PET_FLOAT_OFFSET_X}px`,
      },
      opacity: '0.74',
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
  petDecorations: Record<PetMood, vscode.TextEditorDecorationType>,
): void {
  const empty: vscode.DecorationOptions[] = [];
  for (const decoration of Object.values(petDecorations)) {
    editor.setDecorations(decoration, empty);
  }
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

function pickPetEditor(state: EdenState): vscode.TextEditor | undefined {
  return (
    vscode.window.visibleTextEditors.find(
      (editor) => editor.document.uri.toString() === state.petAnchorDocument,
    ) ?? vscode.window.activeTextEditor
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

function buildPetLayerCss(topOffset: number): string {
  return [
    'none',
    'position: relative',
    `top: ${topOffset}px`,
    'pointer-events: none',
    'z-index: 10',
    'vertical-align: top',
  ].join('; ');
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
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
      statusText: '\u5e95\u90e8\u4e50\u56ed\u5df2\u6253\u5f00\uff0c\u5ba0\u7269\u6b63\u8d74\u5728\u9762\u677f\u4e0a\u8fb9\u7f18\u966a\u4f60\u5199\u4ee3\u7801\u3002',
    };
  }

  if (target.reason === 'visible') {
    return {
      enabled: true,
      actuallyVisible: true,
      toggleLabel: '\u9690\u85cf\u4ee3\u7801\u533a\u5ba0\u7269',
      statusText: '\u4ee3\u7801\u533a\u5ba0\u7269\u5df2\u5f00\u542f\uff0c\u5f53\u524d\u6b63\u5728\u89c6\u53e3\u53f3\u4fa7\u7a7a\u767d\u533a\u8f7b\u91cf\u663e\u793a\u3002',
    };
  }

  if (dockVisible || target.mode === 'dock-edge') {
    return {
      enabled: true,
      actuallyVisible: false,
      toggleLabel: '\u9690\u85cf\u4ee3\u7801\u533a\u5ba0\u7269',
      statusText: '\u5e95\u90e8\u4e50\u56ed\u5df2\u6253\u5f00\uff0c\u4f46\u5f53\u524d\u5e95\u8fb9\u533a\u57df\u53f3\u4fa7\u7a7a\u95f4\u4e0d\u591f\u5b89\u5168\uff0c\u6240\u4ee5\u6682\u65f6\u4e0d\u8ba9\u5ba0\u7269\u63a2\u51fa\u3002',
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
    statusText: '\u4ee3\u7801\u533a\u5ba0\u7269\u5df2\u5f00\u542f\uff0c\u5207\u6362\u5230\u53ef\u663e\u793a\u7684\u4ee3\u7801\u7f16\u8f91\u5668\u540e\u4f1a\u5c1d\u8bd5\u51fa\u73b0\u3002',
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