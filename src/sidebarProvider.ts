import * as vscode from 'vscode';

import { EdenViewState } from './types';

export type SidebarMessage =
  | { type: 'ready' }
  | { type: 'renamePet' }
  | { type: 'placePiano' }
  | { type: 'openDock' }
  | { type: 'toggleEditorPet' }
  | { type: 'setTheme'; theme: 'cyber-oasis' | 'pixel-meadow' };

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
    const petUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'gopher-normal.svg'),
    );
    const petAlertUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'gopher-alert.svg'),
    );
    const petWorkingUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'gopher-working.svg'),
    );

    return `<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="stylesheet" href="${styleUri}" />
    <title>Gopher 乐园</title>
  </head>
  <body
    class="theme-cyber-oasis"
    data-pet-normal="${petUri}"
    data-pet-alert="${petAlertUri}"
    data-pet-working="${petWorkingUri}"
  >
    <main class="app">
      <section class="hero">
        <button class="pet-card" type="button" data-action="renamePet" title="给宠物起名">
          <img src="${petUri}" alt="Gopher 宠物" class="pet-image" />
          <div>
            <p class="eyebrow">陪伴搭子</p>
            <h1 id="pet-name">Moss</h1>
            <p id="pet-status" class="status-pill">悠闲中</p>
          </div>
        </button>
      </section>

      <section class="panel">
        <h2>资源面板</h2>
        <div class="resource-grid">
          <article class="resource-card">
            <span class="resource-label">碎砖</span>
            <strong id="resource-bricks">0</strong>
            <small>每新增 10 行有效代码 +1</small>
          </article>
          <article class="resource-card">
            <span class="resource-label">露珠</span>
            <strong id="resource-dew">0</strong>
            <small>大段删除或重构时获得</small>
          </article>
        </div>
      </section>

      <section class="panel">
        <h2>代码区宠物</h2>
        <div class="actions">
          <button id="editor-pet-toggle" class="action-button action-primary" type="button" data-action="toggleEditorPet">
            在代码区显示宠物
          </button>
        </div>
        <p id="editor-pet-summary" class="helper-copy">代码区宠物已关闭。你可以随时重新打开。</p>
      </section>

      <section class="panel">
        <h2>底部乐园</h2>
        <div class="actions">
          <button class="action-button action-primary" type="button" data-action="placePiano">
            摆放钢琴
          </button>
          <button class="action-button" type="button" data-action="openDock">
            打开底部乐园
          </button>
        </div>
        <p class="helper-copy">钢琴和宠物都可以在底部乐园里拖动调整位置。</p>
      </section>

      <section class="panel">
        <h2>主题风格</h2>
        <div class="theme-grid">
          <button class="theme-button is-active" type="button" data-theme="cyber-oasis">
            赛博绿洲
          </button>
          <button class="theme-button" type="button" data-theme="pixel-meadow">
            像素乡野
          </button>
        </div>
      </section>
    </main>
    <script src="${scriptUri}"></script>
  </body>
</html>`;
  }
}