import * as vscode from 'vscode';

import { EdenViewState } from './types';

export type DockMessage =
  | { type: 'ready' }
  | { type: 'renamePet' }
  | { type: 'placePiano' }
  | { type: 'toggleEditorPet' }
  | { type: 'movePet'; x: number; y: number }
  | { type: 'moveFurniture'; id: string; x: number; y: number };

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
    const petUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'gopher-normal.svg'),
    );
    const petAlertUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'gopher-alert.svg'),
    );
    const petWorkingUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'gopher-working.svg'),
    );
    const pianoUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'piano.svg'));

    return `<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="stylesheet" href="${styleUri}" />
    <title>底部乐园</title>
  </head>
  <body
    data-pet-normal="${petUri}"
    data-pet-alert="${petAlertUri}"
    data-pet-working="${petWorkingUri}"
    data-piano="${pianoUri}"
  >
    <main class="dock-app">
      <header class="dock-header">
        <div>
          <p class="eyebrow">底部乐园</p>
          <h1>拖动摆件，不挡代码</h1>
          <p class="description">代码区宠物由你主动控制显示，真正的拖拽与互动都留在这里完成。</p>
          <p id="editor-pet-summary" class="description">代码区宠物已关闭。你可以随时重新打开。</p>
        </div>
        <div class="header-actions">
          <button id="dock-editor-pet-toggle" class="toolbar-button secondary" type="button" data-action="toggleEditorPet">在代码区显示宠物</button>
          <button class="toolbar-button" type="button" data-action="placePiano">摆放钢琴</button>
          <button class="toolbar-button secondary" type="button" data-action="renamePet">给宠物起名</button>
        </div>
      </header>
      <section id="stage" class="stage" aria-label="底部乐园舞台">
        <div class="floor"></div>
        <div id="entities" class="entities"></div>
      </section>
    </main>
    <script src="${scriptUri}"></script>
  </body>
</html>`;
  }
}