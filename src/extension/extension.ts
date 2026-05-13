import * as vscode from "vscode";

import {
  CetzitFigureEditorProvider,
  CetzitStylesEditorProvider,
} from "./editors";
import { scaffoldProject } from "./scaffold";

function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(
      "cetzit.figureEditor",
      new CetzitFigureEditorProvider(context),
      {
        webviewOptions: { retainContextWhenHidden: true },
        supportsMultipleEditorsPerDocument: false,
      }
    )
  );

  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(
      "cetzit.stylesEditor",
      new CetzitStylesEditorProvider(context),
      {
        webviewOptions: { retainContextWhenHidden: true },
        supportsMultipleEditorsPerDocument: false,
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("cetzit.showError", showError)
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("cetzit.openFigureEditor", openFigureEditor)
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("cetzit.scaffoldProject", () => scaffoldProject(context))
  );

  // GUI commands are forwarded to the webview so the figure editor can handle
  // them (cut/copy/paste, tool selection, viewport actions, etc.).
  const guiCommands = [
    "cetzit.gui.cut",
    "cetzit.gui.copy",
    "cetzit.gui.paste",
    "cetzit.gui.delete",
    "cetzit.gui.moveLeft",
    "cetzit.gui.moveRight",
    "cetzit.gui.moveUp",
    "cetzit.gui.moveDown",
    "cetzit.gui.nudgeLeft",
    "cetzit.gui.nudgeRight",
    "cetzit.gui.nudgeUp",
    "cetzit.gui.nudgeDown",
    "cetzit.gui.joinPaths",
    "cetzit.gui.splitPaths",
    "cetzit.gui.mergeNodes",
    "cetzit.gui.reflectNodesHorizontally",
    "cetzit.gui.reflectNodesVertically",
    "cetzit.gui.reverseEdges",
    "cetzit.gui.bringToFront",
    "cetzit.gui.sendToBack",
    "cetzit.gui.bringForward",
    "cetzit.gui.sendBackward",
    "cetzit.gui.selectAll",
    "cetzit.gui.deselectAll",
    "cetzit.gui.extendSelectionLeft",
    "cetzit.gui.extendSelectionRight",
    "cetzit.gui.extendSelectionUp",
    "cetzit.gui.extendSelectionDown",
    "cetzit.gui.selectTool",
    "cetzit.gui.nodeTool",
    "cetzit.gui.edgeTool",
    "cetzit.gui.viewTikzSource",
    "cetzit.gui.toggleStylePanel",
    "cetzit.gui.zoomIn",
    "cetzit.gui.zoomOut",
    "cetzit.gui.centerViewport",
  ];
  for (const command of guiCommands) {
    context.subscriptions.push(
      vscode.commands.registerCommand(command, () => sendCommand(command))
    );
  }
}

function sendCommand(command: string): void {
  const panel = CetzitFigureEditorProvider.currentPanel();
  if (panel) {
    panel.webview.postMessage({ type: "command", content: command });
  }
}

async function showError(uri: string, line?: number, column?: number): Promise<void> {
  await vscode.window.showTextDocument(vscode.Uri.parse(uri), {
    selection: new vscode.Range(line ?? 0, column ?? 0, line ?? 0, column ?? 0),
  });
}

function openFigureEditor(): void {
  if (vscode.window.activeTextEditor) {
    const uri = vscode.window.activeTextEditor.document.uri;
    if (uri.fsPath.endsWith(".typ")) {
      if (!vscode.window.activeTextEditor.document.isDirty) {
        vscode.commands.executeCommand("workbench.action.closeActiveEditor");
      }
      vscode.commands.executeCommand("vscode.openWith", uri, "cetzit.figureEditor");
    }
  }
}

function deactivate(): void {}

export { activate, deactivate };
