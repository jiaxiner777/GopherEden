import * as vscode from 'vscode';

import { EdenViewState } from './types';

export type DockMessage =
  | { type: 'ready' }
  | { type: 'renamePet' }
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
    <title>&#24213;&#37096;&#20048;&#22253;</title>
  </head>
  <body
    data-pet-normal="${petUri}"
    data-pet-alert="${petAlertUri}"
    data-pet-working="${petWorkingUri}"
    data-asset-piano="${assetData.piano}"
    data-asset-bench="${assetData.bench}"
    data-asset-tree="${assetData.tree}"
    data-asset-lamp="${assetData.lamp}"
    data-asset-grass="${assetData.grass}"
  >
    <main class="dock-app">
      <header class="dock-header dock-toolbar">
        <div class="dock-status">
          <p class="eyebrow">GOPHER &#20048;&#22253;</p>
          <p id="editor-pet-summary" class="description subtle">&#20195;&#30721;&#21306;&#23456;&#29289;&#24050;&#20851;&#38381;&#12290;&#20320;&#21487;&#20197;&#38543;&#26102;&#37325;&#26032;&#25171;&#24320;&#12290;</p>
        </div>
        <div class="header-actions">
          <button id="dock-editor-pet-toggle" class="toolbar-button secondary" type="button" data-action="toggleEditorPet">&#22312;&#20195;&#30721;&#21306;&#26174;&#31034;&#23456;&#29289;</button>
          <button class="toolbar-button secondary" type="button" data-action="openHabitat">&#25171;&#24320;&#20391;&#36793;&#26639;</button>
          <button class="toolbar-button secondary" type="button" data-action="renamePet">&#32473;&#23456;&#29289;&#36215;&#21517;</button>
          <button class="toolbar-button danger" type="button" data-action="returnAllPlacements">&#19968;&#38190;&#20840;&#37096;&#25910;&#22238;&#32972;&#21253;</button>
        </div>
      </header>
      <section id="stage" class="stage" aria-label="&#24213;&#37096;&#20048;&#22253;&#33310;&#21488;">
        <div class="sky-band"></div>
        <div class="floor"></div>
        <div id="entities" class="entities"></div>
      </section>
      <section class="dock-panel">
        <button class="panel-title-row" type="button" id="dock-manage-toggle">
          <span>
            <strong>&#33310;&#21488;&#25670;&#20214;&#31649;&#29702;</strong>
            <small id="dock-summary" class="chip muted">0 &#20010;&#25670;&#20214;</small>
          </span>
          <span id="dock-fold-indicator" class="fold-indicator">&#23637;&#24320;</span>
        </button>
        <div id="dock-manage-body" class="dock-manage-body is-hidden">
          <div id="dock-empty" class="empty-state">&#24403;&#21069;&#33310;&#21488;&#24456;&#24178;&#20928;&#65292;&#20808;&#21435;&#20391;&#36793;&#26639;&#21830;&#24215;&#36141;&#20080;&#23478;&#20855;&#65292;&#20877;&#25226;&#23427;&#20204;&#25670;&#21040;&#36825;&#37324;&#12290;</div>
          <div id="dock-list" class="dock-list"></div>
        </div>
      </section>
    </main>
    <script src="${scriptUri}"></script>
  </body>
</html>`;
  }
}
