import * as fs from 'fs';
import * as vscode from 'vscode';

import { EdenViewState } from './types';

export type DockMessage =
  | { type: 'ready' }
  | { type: 'renamePet' }
  | { type: 'playWithPet' }
  | { type: 'toggleEditorPet' }
  | { type: 'openHabitat' }
  | { type: 'returnAllPlacements' }
  | { type: 'movePet'; x: number; y: number }
  | { type: 'moveFurniture'; id: string; x: number; y: number }
  | { type: 'placementAction'; id: string; action: string };

export class EdenDockProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'gophersEden.dock';

  private view: vscode.WebviewView | undefined;

  public constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly onVisibilityChange?: (visible: boolean) => void,
  ) {}

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    this.view = webviewView;
    webviewView.onDidChangeVisibility(() => {
      this.onVisibilityChange?.(webviewView.visible);
    });
    this.onVisibilityChange?.(webviewView.visible);

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'media')],
    };
    webviewView.webview.html = this.getHtml(webviewView.webview);
  }

  public isVisible(): boolean {
    return this.view?.visible ?? false;
  }

  public postState(viewState: EdenViewState): void {
    this.view?.webview.postMessage({
      type: 'state',
      payload: viewState,
    });
  }

  private getHtml(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'dock.js'));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'dock.css'));

    const petMarkup = {
      normal1: this.readSvgMarkup('gopher-normal-1.svg'),
      normal2: this.readSvgMarkup('gopher-normal-2.svg'),
      alert1: this.readSvgMarkup('gopher-alert-1.svg'),
      alert2: this.readSvgMarkup('gopher-alert-2.svg'),
      working1: this.readSvgMarkup('gopher-working-1.svg'),
      working2: this.readSvgMarkup('gopher-working-2.svg'),
    };

    const effectMarkup = {
      heart: this.readSvgMarkup('pet-heart.svg'),
      alert: this.readSvgMarkup('pet-alert-mark.svg'),
      sparkle: this.readSvgMarkup('pet-sparkle.svg'),
    };

    const furnitureData = {
      piano: this.getInlineSvgDataUri('piano.svg'),
      bench: this.getInlineSvgDataUri('bench.svg'),
      tree: this.getInlineSvgDataUri('tree.svg'),
      lamp: this.getInlineSvgDataUri('lamp.svg'),
      grass: this.getInlineSvgDataUri('grass.svg'),
    };

    const assetPayload = this.serializeForInlineScript({ petMarkup, effectMarkup });

    return `<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="stylesheet" href="${styleUri}" />
    <title>底部乐园</title>
  </head>
  <body
    data-asset-piano="${furnitureData.piano}"
    data-asset-bench="${furnitureData.bench}"
    data-asset-tree="${furnitureData.tree}"
    data-asset-lamp="${furnitureData.lamp}"
    data-asset-grass="${furnitureData.grass}"
  >
    <script id="eden-assets" type="application/json">${assetPayload}</script>
    <main class="dock-app">
      <header class="dock-header dock-toolbar">
        <div class="dock-status">
          <p class="eyebrow">GOPHER 乐园</p>
          <p class="stage-title">像素伊甸小屋</p>
          <p id="editor-pet-summary" class="description subtle">代码区宠物已关闭。你可以随时重新打开。</p>
        </div>
        <div class="header-actions">
          <button class="toolbar-button" type="button" data-action="playWithPet">逗它一下</button>
          <button id="dock-editor-pet-toggle" class="toolbar-button secondary" type="button" data-action="toggleEditorPet">在代码区显示宠物</button>
          <button class="toolbar-button secondary" type="button" data-action="openHabitat">打开侧边栏</button>
          <button class="toolbar-button secondary" type="button" data-action="renamePet">给宠物起名</button>
          <button class="toolbar-button danger" type="button" data-action="returnAllPlacements">一键全部收回背包</button>
        </div>
      </header>
      <section id="stage" class="stage" aria-label="底部乐园舞台">
        <div class="wallpaper"></div>
        <div class="window-glow"></div>
        <div class="rug"></div>
        <div class="floor"></div>
        <div id="entities" class="entities"></div>
      </section>
      <section class="dock-panel">
        <button class="panel-title-row" type="button" id="dock-manage-toggle">
          <span>
            <strong>舞台摆件管理</strong>
            <small id="dock-summary" class="chip muted">0 个摆件</small>
          </span>
          <span id="dock-fold-indicator" class="fold-indicator">展开</span>
        </button>
        <div id="dock-manage-body" class="dock-manage-body is-hidden">
          <div id="dock-empty" class="empty-state">当前舞台很干净，先去侧边栏商店买家具，再把它们摆到这里。</div>
          <div id="dock-list" class="dock-list"></div>
        </div>
      </section>
    </main>
    <script src="${scriptUri}"></script>
  </body>
</html>`;
  }

  private readSvgMarkup(fileName: string): string {
    const filePath = vscode.Uri.joinPath(this.extensionUri, 'media', fileName).fsPath;
    return fs.readFileSync(filePath, 'utf8').replace(/^<\?xml[^>]*>\s*/i, '');
  }

  private getInlineSvgDataUri(fileName: string): string {
    const filePath = vscode.Uri.joinPath(this.extensionUri, 'media', fileName).fsPath;
    const svg = fs.readFileSync(filePath, 'utf8');
    return `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`;
  }

  private serializeForInlineScript(value: unknown): string {
    return JSON.stringify(value).replace(/</g, '\\u003c');
  }
}
