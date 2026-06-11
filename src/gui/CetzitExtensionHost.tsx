import { render } from "preact";
import FigureEditor, { FigureEditorContent } from "./FigureEditor";
import StyleEditor, { StyleEditorContent } from "./StyleEditor";
import "./vscodevars.css";
import "./gui.css";
import { ParseError } from "../lib/CetzitParser";
import CetzitHost from "../lib/CetzitHost";
import CetzitHostContext from "./CetzitHostContext";

// VSCode WebView API (should be available globally in webview context)
declare const acquireVsCodeApi: () => any;

class CetzitExtensionHost extends CetzitHost {
  private vscode: VsCodeApi;
  private config: { [key: string]: any } = {};
  private listener: ((event: MessageEvent) => void) | undefined = undefined;
  private updateToGuiHandler: ((source: string) => void) | undefined = undefined;
  private commandHandler: ((command: string) => void) | undefined = undefined;
  private tikzStylesUpdatedHandler: ((filename: string, source: string) => void) | undefined =
    undefined;
  constructor() {
    super();
    this.vscode = acquireVsCodeApi();
    this.listener = (event: MessageEvent) => {
      const message = event.data;
      // console.log("Received message:", message);
      switch (message.type) {
        case "updateToGui": {
          // `message.content` may legitimately be the empty string when the
          // user has undone all the way back to a blank document — accept
          // any defined string, not just truthy ones.
          if (message.content !== undefined && this.updateToGuiHandler) {
            this.updateToGuiHandler(message.content);
          }
          break;
        }
        case "tikzStylesContent": {
          if (message.content !== undefined && this.tikzStylesUpdatedHandler) {
            this.tikzStylesUpdatedHandler(message.content.filename, message.content.source);
          }
          break;
        }
        case "command": {
          if (message.content !== undefined && this.commandHandler) {
            this.commandHandler(message.content);
          }
          break;
        }
      }
    };

    window.addEventListener("message", this.listener);
  }

  destroy() {
    window.removeEventListener("message", this.listener!);
  }

  public getConfig(key: string): any {
    return this.config[key];
  }

  public onUpdateToGui(handler: (source: string) => void) {
    this.updateToGuiHandler = handler;
  }

  public onTikzStylesUpdated(handler: (filename: string, source: string) => void) {
    this.tikzStylesUpdatedHandler = handler;
  }

  public onCommand(handler: (command: string) => void) {
    this.commandHandler = handler;
  }

  public setErrors(errors: ParseError[]) {
    this.vscode.postMessage({
      type: "setErrors",
      content: errors.map(e => ({
        line: e.line - 1,
        column: e.column - 1,
        message: e.message,
      })),
    });
  }

  public updateFromGui(tikz: string) {
    this.vscode.postMessage({
      type: "updateFromGui",
      content: tikz,
    });
  }

  public refreshTikzStyles() {
    this.vscode.postMessage({
      type: "refreshTikzStyles",
    });
  }

  public openTikzStyles() {
    this.vscode.postMessage({
      type: "openTikzStyles",
    });
  }

  public openCodeEditor(position?: { line: number; column: number }) {
    this.vscode.postMessage({
      type: "openCodeEditor",
      content: position ?? { line: 0, column: 0 },
    });
  }

  // Tells the extension whether keyboard focus is currently inside the
  // node-label input field. The extension mirrors this to a VS Code
  // `setContext` key (`cetzit.labelFieldFocused`) so the `gui.*` clipboard
  // / selection / movement keybindings can be gated to skip when the user
  // is typing in the label — otherwise VS Code intercepts cmd-C/V/X
  // before the webview sees them and the input can't be edited normally.
  // `inputFocus` (the built-in context) doesn't help here because it only
  // tracks focus inside VS Code's own inputs, not webview ones.
  public setLabelFieldFocused(focused: boolean) {
    this.vscode.postMessage({
      type: "setLabelFieldFocused",
      content: focused,
    });
  }

  public renderFigureEditor(container: HTMLElement, initialContent: FigureEditorContent) {
    try {
      this.config = initialContent.config;
      render(
        <CetzitHostContext value={this}>
          <FigureEditor initialContent={initialContent} />
        </CetzitHostContext>,
        container
      );
    } catch (error) {
      console.error("Error rendering FigureEditor:", error);
      container.innerHTML = `<div style="padding: 20px; color: red;">${error}</div>`;
    }
  }

  public renderStyleEditor(container: HTMLElement, initialContent: StyleEditorContent) {
    try {
      this.config = initialContent.config;
      render(
        <CetzitHostContext value={this}>
          <StyleEditor initialContent={initialContent} />
        </CetzitHostContext>,
        container
      );
    } catch (error) {
      console.error("Error rendering StyleEditor:", error);
      container.innerHTML = `<div style="padding: 20px; color: red;">${error}</div>`;
    }
  }
}

export { CetzitExtensionHost };
