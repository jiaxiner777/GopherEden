import * as fs from 'fs';
import * as vscode from 'vscode';

import {
  getFurnitureAssetPath,
  getPetAssetPath,
  getPetEffectAssetPath,
  getWebviewScriptUri,
  getWebviewStyleUri,
} from './mediaPaths';
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
    const scriptUri = getWebviewScriptUri(webview, this.extensionUri, 'dock.js');
    const styleUri = getWebviewStyleUri(webview, this.extensionUri, 'dock.css');

    const petMarkup = {
      normal1: this.readSvgMarkup(getPetAssetPath('primitives', 'gopher-normal-1.svg')),
      normal2: this.readSvgMarkup(getPetAssetPath('primitives', 'gopher-normal-2.svg')),
      alert1: this.readSvgMarkup(getPetAssetPath('primitives', 'gopher-alert-1.svg')),
      alert2: this.readSvgMarkup(getPetAssetPath('primitives', 'gopher-alert-2.svg')),
      working1: this.readSvgMarkup(getPetAssetPath('primitives', 'gopher-working-1.svg')),
      working2: this.readSvgMarkup(getPetAssetPath('primitives', 'gopher-working-2.svg')),
    };

    const effectMarkup = {
      heart: this.readSvgMarkup(getPetEffectAssetPath('pet-heart.svg')),
      alert: this.readSvgMarkup(getPetEffectAssetPath('pet-alert-mark.svg')),
      sparkle: this.readSvgMarkup(getPetEffectAssetPath('pet-sparkle.svg')),
    };

    const furnitureData = {
      piano: this.getInlineSvgDataUri(getFurnitureAssetPath('piano')),
      bench: this.getInlineSvgDataUri(getFurnitureAssetPath('bench')),
      tree: this.getInlineSvgDataUri(getFurnitureAssetPath('tree')),
      lamp: this.getInlineSvgDataUri(getFurnitureAssetPath('lamp')),
      grass: this.getInlineSvgDataUri(getFurnitureAssetPath('grass')),
    };
    const summerData = {
      floorTiles: this.getInlineBinaryDataUri(['furniture', 'summer_limited', 'floor-tiles.png'], 'image/png'),
      floorBlendMask: this.getInlineBinaryDataUri(['furniture', 'summer_limited', 'floor-blend-mask.png'], 'image/png'),
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
    data-summer-floor-tiles="${summerData.floorTiles}"
    data-summer-floor-blend-mask="${summerData.floorBlendMask}"
  >
    <script id="eden-assets" type="application/json">${assetPayload}</script>
    <main class="dock-app">
      <header class="dock-header dock-toolbar">
        <div class="dock-status">
          <p class="eyebrow">GOPHER 乐园</p>
          <p class="stage-title">像素伊甸小屋</p>
          <div class="dock-chip-row">
            <span id="dock-lineage-chip" class="chip">原型派</span>
            <span id="dock-stage-chip" class="chip muted">初生期</span>
          </div>
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

  private readSvgMarkup(pathSegments: readonly string[]): string {
    const filePath = vscode.Uri.joinPath(this.extensionUri, 'media', ...pathSegments).fsPath;
    return fs.readFileSync(filePath, 'utf8').replace(/^<\?xml[^>]*>\s*/i, '');
  }

  private getInlineSvgDataUri(pathSegments: readonly string[]): string {
    const filePath = vscode.Uri.joinPath(this.extensionUri, 'media', ...pathSegments).fsPath;
    const svg = fs.readFileSync(filePath, 'utf8');
    return `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`;
  }

  private getInlineBinaryDataUri(pathSegments: readonly string[], mimeType: string): string {
    const filePath = vscode.Uri.joinPath(this.extensionUri, 'media', ...pathSegments).fsPath;
    const content = fs.readFileSync(filePath);
    return `data:${mimeType};base64,${content.toString('base64')}`;
  }

  private serializeForInlineScript(value: unknown): string {
    return JSON.stringify(value).replace(/</g, '\\u003c');
  }
}
