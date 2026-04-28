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
  getRoomLayoutConfig,
  getFloorTileAssetPath,
  getFloorTileMaskPath,
} from './roomConfig';
import { EdenTheme, FurnitureAnchorType, FurnitureKind, EdenViewState, PetLineage } from './types';

export type SidebarMessage =
  | { type: 'ready' }
  | { type: 'renamePet' }
  | { type: 'playWithPet' }
  | { type: 'openDock' }
  | { type: 'toggleEditorPet' }
  | { type: 'redetectLineage' }
  | { type: 'setLineage'; lineage: PetLineage }
  | { type: 'setEditorPetScale'; scale: number }
  | { type: 'toggleSection'; section: string }
  | { type: 'returnAllPlacements' }
  | { type: 'setTheme'; theme: EdenTheme }
  | { type: 'buyItem'; kind: FurnitureKind }
  | { type: 'placeFurniture'; kind: FurnitureKind; anchorType: FurnitureAnchorType }
  | { type: 'placementAction'; id: string; action: string };

export class EdenSidebarProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'gophersEden.sidebar';

  private view: vscode.WebviewView | undefined;

  public constructor(private readonly extensionUri: vscode.Uri) {}

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'media')],
    };
    webviewView.webview.html = this.getHtml(webviewView.webview);
  }

  public postState(viewState: EdenViewState): void {
    this.view?.webview.postMessage({
      type: 'state',
      payload: viewState,
    });
  }

  private getHtml(webview: vscode.Webview): string {
    const scriptUri = getWebviewScriptUri(webview, this.extensionUri, 'sidebar.js');
    const styleUri = getWebviewStyleUri(webview, this.extensionUri, 'sidebar.css');

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
    for (const kind of getFurnitureKinds()) {
      furnitureImages[kind] = this.getWebviewUri(webview, getFurnitureAssetPath(kind));
      furnitureLabels[kind] = getFurnitureLabel(kind);
    }

    const roomLayout = getRoomLayoutConfig();
    const floorTile = this.getWebviewUri(webview, getFloorTileAssetPath(roomLayout.floor));
    const maskPath = getFloorTileMaskPath(roomLayout.floor);
    const floorTileMask = maskPath ? this.getWebviewUri(webview, maskPath) : '';

    const assetPayload = this.serializeForInlineScript({
      petMarkup,
      allPetMarkup,
      effectMarkup,
      furnitureImages,
      furnitureLabels,
      floorTile,
      floorTileMask,
    });

    return `<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="stylesheet" href="${styleUri}" />
    <title>Gopher 乐园</title>
  </head>
  <body class="theme-cyber-oasis">
    <script id="eden-assets" type="application/json">${assetPayload}</script>
    <main class="app">
      <section class="hero">
        <button class="pet-card" type="button" data-action="renamePet" title="给宠物起名">
          <div id="sidebar-pet-stage" class="pet-stage">
            <div class="pet-shadow"></div>
            <div class="pet-platform"></div>
            <div class="pet-image" role="img" aria-label="Gopher 宠物">${petMarkup.normal1}</div>
          </div>
          <div class="pet-copy">
            <p class="eyebrow">GOPHER'S EDEN</p>
            <h1 id="pet-name">Moss</h1>
            <p id="pet-status" class="status-pill">悠闲中</p>
            <div class="pet-chip-row">
              <span id="pet-lineage-chip" class="pet-chip">原型派</span>
              <span id="pet-stage-chip" class="pet-chip pet-chip-strong">初生期</span>
            </div>
            <p class="helper-copy compact">点击宠物卡可以改名，逗玩、保存、买家具和摆放家具都会让它继续成长。</p>
          </div>
        </button>
        <div class="hero-actions">
          <button class="action-button action-primary" type="button" data-action="playWithPet">逗它一下</button>
          <button id="editor-pet-toggle" class="action-button" type="button" data-action="toggleEditorPet">在代码区显示宠物</button>
          <button class="action-button ghost" type="button" data-action="openDock">打开底部乐园</button>
        </div>
        <p id="editor-pet-summary" class="helper-copy">代码区宠物已关闭。你可以随时重新打开。</p>
        <div class="pet-size-control">
          <div class="pet-size-header">
            <span>代码区宠物大小</span>
            <strong id="editor-pet-scale-value">100%</strong>
          </div>
          <input id="editor-pet-scale" class="pet-size-slider" type="range" min="70" max="220" step="10" value="100" />
          <p class="helper-copy compact">这里只调整代码区里的轻量投影，底部乐园里的大小由成长阶段自动控制。</p>
        </div>
      </section>

      <section class="panel resource-panel">
        <div class="panel-header">
          <h2>资源面板</h2>
          <span class="panel-badge">项目级存档</span>
        </div>
        <div class="resource-grid">
          <article class="resource-card">
            <span class="resource-label">碎砖</span>
            <strong id="resource-bricks">0</strong>
            <small>每新增 10 行有效源码或文本 +1，忽略 .gitignore、压缩包与构建产物。</small>
          </article>
          <article class="resource-card">
            <span class="resource-label">露珠</span>
            <strong id="resource-dew">0</strong>
            <small>单次删改超过 5 行逻辑时获得，用来买更特别的小摆件。</small>
          </article>
        </div>
        <div class="theme-grid">
          <button class="theme-button is-active" type="button" data-theme="cyber-oasis">赛博绿洲</button>
          <button class="theme-button" type="button" data-theme="pixel-meadow">像素乡野</button>
        </div>
        <p class="helper-copy">状态会保存到项目中的 <code>.vscode/eden.json</code>。</p>
      </section>

      <section class="panel growth-panel">
        <div class="panel-header">
          <div>
            <h2>成长信息</h2>
            <p class="helper-copy inline-copy">这里会明确告诉你：它属于什么种族、长到哪一阶段、下一步还会发生什么变化。</p>
          </div>
          <span id="growth-stage-pill" class="panel-badge">初生期</span>
        </div>
        <div class="growth-grid">
          <article class="growth-card growth-card-wide">
            <span class="resource-label">当前种族</span>
            <strong id="growth-lineage">Primitives / 原型派</strong>
            <small id="growth-lineage-hint">最朴素、最亲和、最容易满足，动作圆润又放松。</small>
            <p id="growth-lineage-source" class="helper-copy compact growth-source">当前来源：自动判定</p>
          </article>
          <article class="growth-card">
            <span class="resource-label">当前阶段</span>
            <strong id="growth-stage-name">初生期</strong>
            <small id="growth-stage-description">它刚来到这个工程，动作还很稚嫩。</small>
          </article>
          <article class="growth-card">
            <span class="resource-label">成长值</span>
            <strong id="growth-points">0</strong>
            <small id="growth-next">距离下一阶段还差 100 点</small>
          </article>
          <article class="growth-card">
            <span class="resource-label">偏好家具</span>
            <strong id="growth-preference">小木椅、像素盆栽</strong>
            <small id="growth-behavior">它喜欢在长椅和树边慢悠悠地待着，是最可爱松弛的一支。</small>
          </article>
          <article class="growth-card growth-card-wide">
            <span class="resource-label">阶段解锁能力</span>
            <strong id="growth-stage-ability-title">基础陪伴动作</strong>
            <small id="growth-stage-ability-hint">当前只解锁基础 idle / alert / working，和家具的联动还很弱。</small>
          </article>
          <article class="growth-card growth-card-wide">
            <span class="resource-label">当前状态说明</span>
            <strong id="growth-status">轻轻观察中</strong>
            <small id="growth-status-hint">继续写代码、保存成功、逗它一下，都能帮助它从初生期长大。</small>
          </article>
        </div>
        <div class="lineage-picker" aria-label="手动切换种族">
          <button class="lineage-button" type="button" data-lineage-choice="primitives">Primitives</button>
          <button class="lineage-button" type="button" data-lineage-choice="concurrency">Concurrency</button>
          <button class="lineage-button" type="button" data-lineage-choice="protocols">Protocols</button>
          <button class="lineage-button" type="button" data-lineage-choice="chaos">Chaos</button>
        </div>
        <div class="growth-actions">
          <button class="action-button" type="button" data-action="redetectLineage">重新自动判定</button>
        </div>
        <p class="helper-copy compact">手动切换后会优先保留你的选择，后续不会被自动覆盖；只有你主动点击“重新自动判定”才会重新扫描项目。</p>
      </section>

      <section class="panel manage-panel">
        <div class="panel-header stacked">
          <div>
            <h2>空间整理</h2>
            <p class="helper-copy inline-copy">平时保持界面干净，真要摆东西时再展开背包或商店。</p>
          </div>
          <button id="return-all-button" class="mini-button danger" type="button" data-action="returnAllPlacements">一键全部收回背包</button>
        </div>
      </section>

      <section class="fold-panel" data-section-root="inventory">
        <button class="fold-header" type="button" data-toggle-section="inventory">
          <span>
            <strong>背包</strong>
            <small id="inventory-summary">0 件可摆放</small>
          </span>
          <span class="fold-indicator">展开</span>
        </button>
        <div class="fold-body is-hidden" data-section-body="inventory">
          <div id="inventory-empty" class="empty-state">还没有家具，先去商店买一点吧。</div>
          <div id="inventory-list" class="inventory-list"></div>
          <div id="inventory-actions" class="placement-actions is-hidden">
            <p id="inventory-selected" class="helper-copy"></p>
            <div class="placement-button-grid">
              <button class="action-button action-primary" type="button" data-place-anchor="line-bind">摆到代码区 · 跟行</button>
              <button class="action-button" type="button" data-place-anchor="viewport-float">摆到代码区 · 浮层</button>
              <button class="action-button ghost" type="button" data-place-anchor="dock">摆到底部乐园</button>
            </div>
          </div>
        </div>
      </section>

      <section class="fold-panel" data-section-root="placed">
        <button class="fold-header" type="button" data-toggle-section="placed">
          <span>
            <strong>已摆放</strong>
            <small id="placed-summary">0 个摆件</small>
          </span>
          <span class="fold-indicator">展开</span>
        </button>
        <div class="fold-body is-hidden" data-section-body="placed">
          <div id="placed-empty" class="empty-state">当前空间很整洁，还没有摆放任何家具。</div>
          <div id="placed-list" class="placed-list"></div>
        </div>
      </section>

      <section class="fold-panel" data-section-root="shop">
        <button class="fold-header" type="button" data-toggle-section="shop">
          <span>
            <strong>The Well / 商店</strong>
            <small>需要时再展开，别让界面长期像素材测试面板。</small>
          </span>
          <span class="fold-indicator">展开</span>
        </button>
        <div class="fold-body is-hidden" data-section-body="shop">
          <div id="shop-list" class="shop-list"></div>
          <section class="seasonal-showcase">
            <div class="seasonal-showcase-header">
              <strong>夏季限定装修 uu</strong>
              <span class="panel-badge">Summer Limited</span>
            </div>
            <p class="helper-copy">这套主题已经接入当前插件商店。地板采用 1px 深色砖缝、左上高光、右下阴影的 Floor Tiles 结构，并附带中心透明的融合边框素材，方便贴合花盆和家具边缘。</p>
            <div class="seasonal-showcase-grid">
              <article class="seasonal-card">
                <div class="seasonal-preview seasonal-floor-preview" data-summer-preview="floorTiles"></div>
                <div class="shop-copy">
                  <strong>Floor Tiles / 地板瓦片</strong>
                  <small>自带砖缝边框和伪 3D 光影，拼接后会有嵌入式网格感。</small>
                </div>
              </article>
              <article class="seasonal-card">
                <div class="seasonal-preview seasonal-mask-preview" data-summer-preview="floorBlendMask"></div>
                <div class="shop-copy">
                  <strong>Floor Blend Mask / 融合边框</strong>
                  <small>中心透明，只保留边缘高光与阴影，用来把家具底边压进地板里。</small>
                </div>
              </article>
            </div>
          </section>
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
