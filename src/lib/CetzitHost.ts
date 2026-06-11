import { ParseError } from "./CetzitParser";

// Abstract host the GUI talks to. Implementations bridge to the VS Code
// extension or to a plain browser preview. Method names retain "Tikz"
// terminology in places where vstikzit's GUI components reference them; the
// behaviour is cetzit's (Typst figure + styles.typ instead of .tikz files).
export default class CetzitHost {
  onUpdateToGui(_handler: (source: string) => void): void {}
  updateFromGui(_source: string): void {}
  onCommand(_handler: (command: string) => void): void {}
  onTikzStylesUpdated(_handler: (filename: string, styles: string) => void): void {}
  setErrors(_errors: ParseError[]): void {}
  refreshTikzStyles(): void {}
  openTikzStyles(): void {}
  openCodeEditor(_position?: { line: number; column: number }): void {}
  // Hooked from StylePanel's label-input focus/blur. The VS Code host
  // mirrors this to a `setContext` key so the gui.* keybindings can
  // disable themselves while the user is typing in the input.
  setLabelFieldFocused(_focused: boolean): void {}
  getConfig(_key: string): any {
    return undefined;
  }
}
