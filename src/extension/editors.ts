import * as vscode from "vscode";
import * as path from "path";
import {
  maybePromptForBarrelFile,
  maybePromptForStylesFile,
  readStylesFile,
  sanitizeFuncName,
} from "./scaffold";

function currentUri(): vscode.Uri | undefined {
  const activeTab = vscode.window.tabGroups.activeTabGroup.activeTab;
  if (!activeTab?.input) {
    return undefined;
  }
  const tabInput = activeTab.input as any;
  if (!tabInput.uri) {
    return undefined;
  }
  return tabInput.uri as vscode.Uri;
}

function getNonce(): string {
  let text = "";
  const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

interface WebviewMessage {
  type: string;
  content?: any;
}

class BaseEditorProvider {
  private static openDocuments = new Set<vscode.TextDocument>();
  private static openPanels = new Set<vscode.WebviewPanel>();
  protected context: vscode.ExtensionContext;
  private isUpdatingFromGui: boolean = false;
  protected entryPoint: string = "unknown";
  protected diagnosticCollection: vscode.DiagnosticCollection;

  static documentWithUri(uri: vscode.Uri): vscode.TextDocument | undefined {
    return Array.from(BaseEditorProvider.openDocuments).find(
      doc => doc.uri.toString() === uri.toString()
    );
  }

  static currentDocument(): vscode.TextDocument | undefined {
    const uri = currentUri();
    if (!uri) return undefined;
    return BaseEditorProvider.documentWithUri(uri);
  }

  static currentPanel(): vscode.WebviewPanel | undefined {
    return Array.from(BaseEditorProvider.openPanels).find(panel => panel.active && panel.visible);
  }

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
    this.diagnosticCollection = vscode.languages.createDiagnosticCollection("cetzit");
  }

  protected guiConfig(): { [key: string]: any } {
    const config = vscode.workspace.getConfiguration("cetzit");
    return {
      enableAnimations: config.get<boolean>("enableAnimations", true),
      axisColor: config.get<string>("axisColor", "#8839ef"),
      majorGridColor: config.get<string>("majorGridColor", "#cccccc"),
      minorGridColor: config.get<string>("minorGridColor", "#eeeeee"),
    };
  }

  protected async initialContent(document: vscode.TextDocument): Promise<string> {
    return JSON.stringify({ config: this.guiConfig(), document: document.getText() });
  }

  async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken
  ): Promise<void> {
    BaseEditorProvider.openDocuments.add(document);
    BaseEditorProvider.openPanels.add(webviewPanel);

    webviewPanel.webview.options = { enableScripts: true };

    const contentJson = await this.initialContent(document);
    webviewPanel.webview.html = await this.getHtmlForWebview(webviewPanel.webview, contentJson);

    const changeDocumentSubscription = vscode.workspace.onDidChangeTextDocument(
      (e: vscode.TextDocumentChangeEvent) => {
        if (e.document.uri.toString() === document.uri.toString() && !this.isUpdatingFromGui) {
          webviewPanel.webview.postMessage({
            type: "updateToGui",
            content: document.getText(),
          });
        }
      }
    );

    webviewPanel.webview.onDidReceiveMessage((e: WebviewMessage) => {
      switch (e.type) {
        case "updateFromGui":
          this.updateFromGui(document, e.content);
          return;
        case "refreshTikzStyles":
          this.refreshStyles(webviewPanel.webview);
          return;
        case "openTikzStyles":
          this.openStylesFile();
          return;
        case "openCodeEditor": {
          this.openCodeEditor(e.content.line, e.content.column);
          return;
        }
        case "setErrors": {
          this.setErrors(e.content);
          return;
        }
        case "showErrors": {
          vscode.commands.executeCommand("workbench.panel.markers.view.focus");
          return;
        }
        case "setLabelFieldFocused": {
          // The webview's node-label input has gained / lost focus.
          // Mirror this to a VS Code context key so the cetzit.gui.*
          // keybindings can be gated off while the user is typing —
          // otherwise cmd-C/V/X get intercepted by VS Code and the
          // input becomes effectively read-only for clipboard ops.
          vscode.commands.executeCommand(
            "setContext",
            "cetzit.labelFieldFocused",
            !!e.content
          );
          return;
        }
      }
    });

    webviewPanel.onDidDispose(() => {
      changeDocumentSubscription.dispose();
      BaseEditorProvider.openDocuments.delete(document);
      BaseEditorProvider.openPanels.delete(webviewPanel);
      // The webview is gone before any blur event could fire — reset
      // the context here so the gui.* keybindings re-enable everywhere
      // else if a future editor opens.
      vscode.commands.executeCommand("setContext", "cetzit.labelFieldFocused", false);
    });
  }

  async getHtmlForWebview(webview: vscode.Webview, contentJson: string): Promise<string> {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "dist", "cetzit_vscode.js")
    );
    const cssUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "dist", "cetzit_vscode.css")
    );
    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none';
  style-src 'unsafe-inline' ${webview.cspSource};
  img-src 'unsafe-inline' ${webview.cspSource} data: blob:;
  script-src 'nonce-${nonce}' 'unsafe-eval' ${webview.cspSource};
  font-src ${webview.cspSource};
  worker-src 'self' data: blob:;">
<title>cetzit</title>
<link rel="stylesheet" href="${cssUri}">
<style>
  body {
    margin: 0; padding: 0; height: 100vh; overflow: hidden;
    font-family: var(--tikzit-font-family);
    background-color: var(--tikzit-editor-background);
    color: var(--tikzit-editor-foreground);
  }
  #root { height: 100vh; width: 100vw; }
</style>
</head>
<body>
<div id="root" style="width: 100%; height: 100%;"></div>
<script id="initial-content" type="application/json">${contentJson}</script>
<script nonce="${nonce}" type="module">
import { CetzitExtensionHost } from "${scriptUri}";
window.addEventListener('load', () => {
  const host = new CetzitExtensionHost();
  const container = document.getElementById("root");
  const initialContent = JSON.parse(document.getElementById("initial-content").textContent);
  host.${this.entryPoint}(container, initialContent);
});
</script>
</body>
</html>`;
  }

  async updateFromGui(document: vscode.TextDocument, content: string): Promise<boolean> {
    // Wrap in try/finally so a thrown applyEdit (e.g. document closed
    // mid-edit) never leaves `isUpdatingFromGui` stuck at true — that would
    // silently filter out all later TextDocument changes including Cmd-Z.
    this.isUpdatingFromGui = true;
    try {
      const edit = new vscode.WorkspaceEdit();
      edit.replace(document.uri, new vscode.Range(0, 0, document.lineCount, 0), content);
      return await vscode.workspace.applyEdit(edit);
    } finally {
      this.isUpdatingFromGui = false;
    }
  }

  async setErrors(errors: { line: number; column: number; message: string }[]): Promise<void> {
    const diagnostics: vscode.Diagnostic[] = errors.map(err => {
      const range = new vscode.Range(err.line, err.column, err.line, err.column + 1);
      const diagnostic = new vscode.Diagnostic(range, err.message, vscode.DiagnosticSeverity.Error);
      const uri = BaseEditorProvider.currentDocument()?.uri;
      diagnostic.source = "cetzit Parser";

      if (!uri) return diagnostic;

      diagnostic.code = {
        value: "show source",
        target: vscode.Uri.parse(
          `command:cetzit.showError?${encodeURIComponent(
            JSON.stringify([uri.toString(), err.line, err.column])
          )}`
        ),
      };
      return diagnostic;
    });

    const uri = BaseEditorProvider.currentDocument()?.uri;
    if (uri !== undefined) {
      this.diagnosticCollection.set(uri, diagnostics);
    }
  }

  async refreshStyles(webview: vscode.Webview): Promise<void> {
    const document = BaseEditorProvider.currentDocument();
    const workspaceRoot = document?.uri
      ? vscode.workspace.getWorkspaceFolder(document.uri)?.uri
      : undefined;
    if (!workspaceRoot) {
      webview.postMessage({
        type: "tikzStylesContent",
        content: { filename: "", source: "" },
      });
      return;
    }
    const { filePath, content } = await readStylesFile(workspaceRoot);
    webview.postMessage({
      type: "tikzStylesContent",
      content: { filename: path.basename(filePath), source: content },
    });
  }

  async openStylesFile(): Promise<void> {
    const document = BaseEditorProvider.currentDocument();
    const workspaceRoot = document?.uri
      ? vscode.workspace.getWorkspaceFolder(document.uri)?.uri
      : undefined;
    if (!workspaceRoot) return;
    const { filePath } = await readStylesFile(workspaceRoot);
    vscode.commands.executeCommand("vscode.open", vscode.Uri.file(filePath));
  }

  async openCodeEditor(line: number, column: number): Promise<void> {
    const documentUri = currentUri();
    if (documentUri === undefined) return;

    const editor = await vscode.window.showTextDocument(documentUri);
    if (editor) {
      const position = new vscode.Position(line, column);
      editor.selection = new vscode.Selection(position, position);
      editor.revealRange(
        new vscode.Range(position, position),
        vscode.TextEditorRevealType.InCenter
      );
    }
  }
}

class CetzitFigureEditorProvider
  extends BaseEditorProvider
  implements vscode.CustomTextEditorProvider
{
  constructor(context: vscode.ExtensionContext) {
    super(context);
    this.entryPoint = "renderFigureEditor";
  }

  protected async initialContent(document: vscode.TextDocument): Promise<string> {
    const workspaceRoot = vscode.workspace.getWorkspaceFolder(document.uri)?.uri;
    if (workspaceRoot) {
      // Fire-and-forget: the popups run in parallel with editor init so we
      // don't block opening the figure if the user takes a moment to decide.
      void maybePromptForStylesFile(this.context, workspaceRoot);
      void maybePromptForBarrelFile(this.context, workspaceRoot);
    }
    const { filePath, content: styles } = workspaceRoot
      ? await readStylesFile(workspaceRoot)
      : { filePath: "", content: "" };
    const content = {
      config: this.guiConfig(),
      styleFile: path.basename(filePath),
      styles,
      document: document.getText(),
      documentName: sanitizeFuncName(
        path.basename(document.uri.fsPath, path.extname(document.uri.fsPath))
      ),
    };
    return JSON.stringify(content);
  }
}

class CetzitStylesEditorProvider
  extends BaseEditorProvider
  implements vscode.CustomTextEditorProvider
{
  constructor(context: vscode.ExtensionContext) {
    super(context);
    this.entryPoint = "renderStyleEditor";
  }
}

export { currentUri, CetzitFigureEditorProvider, CetzitStylesEditorProvider };
