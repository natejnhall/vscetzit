import { render } from "preact";
import { FigureEditorContent } from "./FigureEditor";
import StyleEditor, { StyleEditorContent } from "./StyleEditor";
import "./defaultvars.css";
import "./gui.css";
import { ParseError } from "../lib/CetzitParser";
import CetzitHost from "../lib/CetzitHost";
import CetzitHostContext from "./CetzitHostContext";
import App from "./App";

class CetzitBrowserHost extends CetzitHost {
  private config: { [key: string]: any } = {};
  private updateFromGuiHandler: ((source: string) => void) | undefined = undefined;
  private updateToGuiHandler: ((source: string) => void) | undefined = undefined;
  private commandHandler: ((command: string) => void) | undefined = undefined;
  private tikzStylesUpdatedHandler: ((filename: string, source: string) => void) | undefined =
    undefined;

  public onTikzStylesUpdated(handler: (filename: string, source: string) => void) {
    this.tikzStylesUpdatedHandler = handler;
  }

  public setErrors(errors: ParseError[]) {}

  public updateFromGui(tikz: string) {
    if (this.updateFromGuiHandler) {
      this.updateFromGuiHandler(tikz);
    }
  }

  public getConfig(key: string): any {
    return this.config[key];
  }

  public updateToGui(tikz: string) {
    if (this.updateToGuiHandler) {
      this.updateToGuiHandler(tikz);
    }
  }

  public sendCommand(command: string) {
    if (this.commandHandler) {
      this.commandHandler(command);
    }
  }

  public onUpdateFromGui(handler: (tikz: string) => void) {
    this.updateFromGuiHandler = handler;
  }

  public onUpdateToGui(handler: (source: string) => void) {
    this.updateToGuiHandler = handler;
  }

  public onCommand(handler: (command: string) => void) {
    this.commandHandler = handler;
  }

  public refreshTikzStyles() {}

  public openTikzStyles() {}

  public openCodeEditor(position?: { line: number; column: number }) {}

  public renderFigureEditor(container: HTMLElement, initialContent: FigureEditorContent) {
    try {
      this.config = initialContent.config;
      render(
        <CetzitHostContext value={this}>
          <App initialContent={initialContent} />
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

export { CetzitBrowserHost };
