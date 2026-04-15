import * as vscode from 'vscode';

import { EdenTheme, FurnitureAnchorType, FurnitureKind, EdenViewState } from './types';

export type SidebarMessage =
  | { type: 'ready' }
  | { type: 'renamePet' }
  | { type: 'openDock' }
  | { type: 'toggleEditorPet' }
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
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'sidebar.js'));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'sidebar.css'));
    const petUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'gopher-normal.svg'));
    const petAlertUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'gopher-alert.svg'));
    const petWorkingUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'gopher-working.svg'));

    const assetData = {
      piano: webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'piano.svg')),
      bench: webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'bench.svg')),
      tree: webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'tree.svg')),
      lamp: webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'lamp.svg')),
      grass: webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'grass.svg')),
    };

    return `<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="stylesheet" href="${styleUri}" />
    <title>Gopher &#20048;&#22253;</title>
  </head>
  <body
    class="theme-cyber-oasis"
    data-pet-normal="${petUri}"
    data-pet-alert="${petAlertUri}"
    data-pet-working="${petWorkingUri}"
    data-asset-piano="${assetData.piano}"
    data-asset-bench="${assetData.bench}"
    data-asset-tree="${assetData.tree}"
    data-asset-lamp="${assetData.lamp}"
    data-asset-grass="${assetData.grass}"
  >
    <main class="app">
      <section class="hero">
        <button class="pet-card" type="button" data-action="renamePet" title="&#32473;&#23456;&#29289;&#36215;&#21517;">
          <img src="${petUri}" alt="Gopher &#23456;&#29289;" class="pet-image" />
          <div>
            <p class="eyebrow">GOPHER'S EDEN</p>
            <h1 id="pet-name">Moss</h1>
            <p id="pet-status" class="status-pill">&#24736;&#38386;&#20013;</p>
          </div>
        </button>
        <div class="hero-actions">
          <button id="editor-pet-toggle" class="action-button action-primary" type="button" data-action="toggleEditorPet">&#22312;&#20195;&#30721;&#21306;&#26174;&#31034;&#23456;&#29289;</button>
          <button class="action-button" type="button" data-action="openDock">&#25171;&#24320;&#24213;&#37096;&#20048;&#22253;</button>
        </div>
        <p id="editor-pet-summary" class="helper-copy">&#20195;&#30721;&#21306;&#23456;&#29289;&#24050;&#20851;&#38381;&#12290;&#20320;&#21487;&#20197;&#38543;&#26102;&#37325;&#26032;&#25171;&#24320;&#12290;</p>
      </section>

      <section class="panel resource-panel">
        <div class="panel-header">
          <h2>&#36164;&#28304;&#38754;&#26495;</h2>
          <span class="panel-badge">&#39033;&#30446;&#32423;&#23384;&#26723;</span>
        </div>
        <div class="resource-grid">
          <article class="resource-card">
            <span class="resource-label">&#30862;&#30742;</span>
            <strong id="resource-bricks">0</strong>
            <small>&#27599;&#26032;&#22686; 10 &#34892;&#26377;&#25928;&#20195;&#30721; +1</small>
          </article>
          <article class="resource-card">
            <span class="resource-label">&#38706;&#29664;</span>
            <strong id="resource-dew">0</strong>
            <small>&#19968;&#27425;&#21024;&#25913;&#36229;&#36807; 5 &#34892;&#36923;&#36753;&#26102;&#33719;&#24471;</small>
          </article>
        </div>
        <div class="theme-grid">
          <button class="theme-button is-active" type="button" data-theme="cyber-oasis">&#36187;&#21338;&#32511;&#27954;</button>
          <button class="theme-button" type="button" data-theme="pixel-meadow">&#20687;&#32032;&#20065;&#37326;</button>
        </div>
        <p class="helper-copy">&#29366;&#24577;&#20250;&#20445;&#23384;&#21040;&#39033;&#30446;&#20013;&#30340; <code>.vscode/eden.json</code>&#12290;</p>
      </section>

      <section class="panel manage-panel">
        <div class="panel-header">
          <div>
            <h2>&#31354;&#38388;&#25972;&#29702;</h2>
            <p class="helper-copy inline-copy">&#20808;&#20445;&#25345;&#24178;&#20928;&#65292;&#38656;&#35201;&#25670;&#25918;&#26102;&#20877;&#23637;&#24320;&#12290;</p>
          </div>
          <button id="return-all-button" class="mini-button danger" type="button" data-action="returnAllPlacements">&#19968;&#38190;&#20840;&#37096;&#25910;&#22238;&#32972;&#21253;</button>
        </div>
      </section>

      <section class="fold-panel" data-section-root="inventory">
        <button class="fold-header" type="button" data-toggle-section="inventory">
          <span>
            <strong>&#32972;&#21253;</strong>
            <small id="inventory-summary">0 &#20214;&#21487;&#25670;&#25918;</small>
          </span>
          <span class="fold-indicator">&#23637;&#24320;</span>
        </button>
        <div class="fold-body is-hidden" data-section-body="inventory">
          <div id="inventory-empty" class="empty-state">&#36824;&#27809;&#26377;&#23478;&#20855;&#65292;&#20808;&#21435;&#21830;&#24215;&#20080;&#19968;&#28857;&#21543;&#12290;</div>
          <div id="inventory-list" class="inventory-list"></div>
          <div id="inventory-actions" class="placement-actions is-hidden">
            <p id="inventory-selected" class="helper-copy"></p>
            <div class="placement-button-grid">
              <button class="action-button action-primary" type="button" data-place-anchor="line-bind">&#25670;&#21040;&#20195;&#30721;&#21306;&#183;&#36319;&#34892;</button>
              <button class="action-button" type="button" data-place-anchor="viewport-float">&#25670;&#21040;&#20195;&#30721;&#21306;&#183;&#28014;&#23618;</button>
              <button class="action-button" type="button" data-place-anchor="dock">&#25670;&#21040;&#24213;&#37096;&#20048;&#22253;</button>
            </div>
          </div>
        </div>
      </section>

      <section class="fold-panel" data-section-root="placed">
        <button class="fold-header" type="button" data-toggle-section="placed">
          <span>
            <strong>&#24050;&#25670;&#25918;</strong>
            <small id="placed-summary">0 &#20010;&#25670;&#20214;</small>
          </span>
          <span class="fold-indicator">&#23637;&#24320;</span>
        </button>
        <div class="fold-body is-hidden" data-section-body="placed">
          <div id="placed-empty" class="empty-state">&#24403;&#21069;&#31354;&#38388;&#24456;&#25972;&#27905;&#65292;&#36824;&#27809;&#26377;&#25670;&#25918;&#20219;&#20309;&#23478;&#20855;&#12290;</div>
          <div id="placed-list" class="placed-list"></div>
        </div>
      </section>

      <section class="fold-panel" data-section-root="shop">
        <button class="fold-header" type="button" data-toggle-section="shop">
          <span>
            <strong>The Well / &#21830;&#24215;</strong>
            <small>&#38656;&#35201;&#26102;&#20877;&#23637;&#24320;&#25361;&#36873;&#23478;&#20855;</small>
          </span>
          <span class="fold-indicator">&#23637;&#24320;</span>
        </button>
        <div class="fold-body is-hidden" data-section-body="shop">
          <div id="shop-list" class="shop-list"></div>
        </div>
      </section>
    </main>
    <script src="${scriptUri}"></script>
  </body>
</html>`;
  }
}
