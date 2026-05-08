import * as fs from 'fs';
import * as vscode from 'vscode';

import {
  getPetAssetPath,
  getPetEffectAssetPath,
  getWebviewScriptUri,
  getWebviewStyleUri,
} from './mediaPaths';
import {
  getFurnitureKinds,
  getFurnitureLabel,
  getFurnitureAssetPath,
  getFurniturePlacementType,
  getRoomLayoutConfig,
  getFloorTileAssetPath,
  getFloorTileMaskPath,
  getFloorTileVariantPaths,
  getStageSpriteAssetPath,
  getWallTileAssetPath,
} from './roomConfig';
import { EdenViewState, PetLineage } from './types';

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

    const loadLineage = (lineage: PetLineage) => ({
      normal1: this.readSvgMarkup(getPetAssetPath(lineage, 'gopher-normal-1.svg')),
      normal2: this.readSvgMarkup(getPetAssetPath(lineage, 'gopher-normal-2.svg')),
      alert1: this.readSvgMarkup(getPetAssetPath(lineage, 'gopher-alert-1.svg')),
      alert2: this.readSvgMarkup(getPetAssetPath(lineage, 'gopher-alert-2.svg')),
      working1: this.readSvgMarkup(getPetAssetPath(lineage, 'gopher-working-1.svg')),
      working2: this.readSvgMarkup(getPetAssetPath(lineage, 'gopher-working-2.svg')),
    });

    const allPetMarkup = {
      primitives: loadLineage('primitives'),
      concurrency: loadLineage('concurrency'),
      protocols: loadLineage('protocols'),
      chaos: loadLineage('chaos'),
    };
    const petMarkup = allPetMarkup.primitives;

    const effectMarkup = {
      heart: this.readSvgMarkup(getPetEffectAssetPath('pet-heart.svg')),
      alert: this.readSvgMarkup(getPetEffectAssetPath('pet-alert-mark.svg')),
      sparkle: this.readSvgMarkup(getPetEffectAssetPath('pet-sparkle.svg')),
    };

    const furnitureImages: Record<string, string> = {};
    const furnitureLabels: Record<string, string> = {};
    const furniturePlacementTypes: Record<string, string> = {};
    for (const kind of getFurnitureKinds()) {
      furnitureImages[kind] = this.getWebviewUri(webview, getFurnitureAssetPath(kind));
      furnitureLabels[kind] = getFurnitureLabel(kind);
      furniturePlacementTypes[kind] = getFurniturePlacementType(kind);
    }

    const roomLayout = getRoomLayoutConfig();
    const floorTile = this.getWebviewUri(webview, getFloorTileAssetPath(roomLayout.floor));
    const floorTileVariants = getFloorTileVariantPaths(roomLayout.floor).map((pathSegments) => this.getWebviewUri(webview, pathSegments));
    const maskPath = getFloorTileMaskPath(roomLayout.floor);
    const floorTileMask = maskPath ? this.getWebviewUri(webview, maskPath) : '';
    const wallUpperTile = this.getWebviewUri(webview, getWallTileAssetPath(roomLayout.theme.wall.upperTileId));
    const wallLowerTile = this.getWebviewUri(webview, getWallTileAssetPath(roomLayout.theme.wall.lowerTileId));
    const windowSprite = this.getWebviewUri(webview, getStageSpriteAssetPath(roomLayout.theme.window.assetId));

    const assetPayload = this.serializeForInlineScript({
      petMarkup,
      allPetMarkup,
      effectMarkup,
      furnitureImages,
      furnitureLabels,
      furniturePlacementTypes,
      roomLayout,
      roomVisuals: {
        floorTile,
        floorTileVariants,
        floorTileMask,
        wallUpperTile,
        wallLowerTile,
        windowSprite,
      },
    });

    return `<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="stylesheet" href="${styleUri}" />
    <title>底部乐园</title>
  </head>
  <body>
    <script id="eden-assets" type="application/json">${assetPayload}</script>
    <main class="dock-app">
      <section id="stage" class="stage immersive-stage" aria-label="底部乐园舞台">
        <div class="wallpaper"></div>
        <div class="wall-lower"></div>
        <div class="wall-glow"></div>
        <div class="window-frame"></div>
        <div class="rug is-hidden"></div>
        <div class="floor"></div>
        <div class="sun-patch"></div>
        <div class="ao-line"></div>
        <div class="vignette"></div>
        <div id="entities" class="entities"></div>
      </section>
      <section class="dock-panel is-hidden" aria-hidden="true">
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

  private getWebviewUri(webview: vscode.Webview, pathSegments: readonly string[]): string {
    return webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', ...pathSegments),
    ).toString();
  }

  private serializeForInlineScript(value: unknown): string {
    return JSON.stringify(value).replace(/</g, '\\u003c');
  }
}
