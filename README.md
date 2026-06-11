# vscetzit

A VS Code extension that brings a TikZiT-style graphical editor to Typst figure
files, emitting CeTZ-based `.typ` source through a small runtime library
(`cetzit.typ`). Forked from [tikzit/vstikzit](https://github.com/tikzit/vstikzit);
the GUI shell is largely preserved, but the file format, parser, emitter, and
symbol palette have been rewritten for the Typst + CeTZ ecosystem.

## What it does

- Registers a custom editor for `.typ` files under a configurable glob
  (default `**/figures/**/*.typ`).
- Reads and writes the canonical cetzit figure template (a bare `cetz.canvas`
  block that calls `diagram(nodes: (...), edges: (...))`).
- Picks up node and edge styles from a user-owned `styles.typ` file at the
  workspace root.
- `cetzit.typ` (the runtime library) is supplied by the user — download it
  from the distribution and place it at the workspace root alongside
  `main.typ`. `styles.typ` is scaffolded by the editor on first figure open
  (or via a command — see *Quickstart*).
- Approximates the figure on an SVG canvas inside VS Code; Tinymist's live
  preview is the authoritative render.

## Quickstart

```bash
npm install
npm run build   # produces dist/cetzit_vscode.{js,css} and dist/extension.js
```

Then open this folder in VS Code and press **F5** to launch an Extension
Development Host. In the dev host, open any folder that contains both a
`cetzit.typ` at the root (the runtime — copy it from this extension or the
distribution) and a `figures/fig1.typ` to edit. Click `fig1.typ` in the
explorer and the cetzit editor opens.

If the editor doesn't appear automatically, right-click the file → **Reopen
Editor With…** → "cetzit Figure Editor".

`styles.typ` is auto-created at the workspace root on first figure open if
absent. To drop a fresh copy of the runtime library into a workspace, run
**"cetzit: Scaffold cetzit project (cetzit.typ + styles.typ)"** from the
command palette — that copies the bundled `cetzit.typ` (overwriting any
existing one) and creates `styles.typ` if missing. The user-owned
`styles.typ` is never overwritten if it already exists.

## File layout

```
vscetzit/
├── cetzit.typ            runtime library bundled with the extension
├── src/
│   ├── extension/        VS Code-side: custom editor providers, scaffolder
│   ├── gui/              Preact UI: canvas, style panel, editors
│   └── lib/              format-agnostic core: Graph, parser, emitter, …
├── images/               icons used by the GUI toolbar
├── package.json          extension manifest + scripts
└── vite.config.ts        build modes: webview, extension, browser
```

Users place a copy of `cetzit.typ` at the root of their own typst project
(alongside `main.typ`).

## Open improvements

These are the next features we want to land. Listed in roughly the order we'd
tackle them:

- **Style menu GUI.** The current `Style.tsx` exposes only `name`, `stroke`,
  `fill`, and `shape`. The other cetzit style fields (`size`, `min-width`,
  `min-height`, `inner-sep`, `corner-radius`, `sides`, `unlabeled-style`,
  `label-fill`, `loop-*` defaults for edges) require hand-editing
  `styles.typ`. Surface them in the editor with appropriate widgets
  (length sliders, color pickers, dropdowns).
- **GUI support for polygon and pill shapes.** `cetzit.typ` now renders both
  correctly, but the GUI canvas falls back to a square approximation for
  any non-circle shape (`Node.tsx` and `curve.ts`). Render pills as
  rounded rectangles whose width grows with the label, and regular polygons
  using `polygon` SVG primitives keyed on `sides`.
- **Directed edges.** `cetzit.typ` currently emits undirected lines/curves and
  the GUI hides the arrow-tip controls. Add `mark-end` / `mark-start` to the
  edge style schema in `cetzit.typ` (delegating to CeTZ's mark API), surface
  arrow-tip selectors in the GUI's edge style editor, and re-enable the
  `arrowHead`/`arrowTail` rendering paths in `Edge.tsx`.
- **Typst symbol rendering in the GUI canvas.** Today the GUI approximates
  `sym.alpha` → `α` via a static Unicode table in `src/lib/labels.ts`.
  Replace that with a small Typst-to-MathML/SVG renderer (or call out to
  Tinymist for label rendering) so complex expressions, fractions, and
  formatting match what the preview shows.

## Out-of-scope / known limitations

- `polygon` and `path` node shapes are GUI-approximated as rectangles for
  hit-testing; Tinymist's preview is authoritative for the actual shape.
- Per-edge anchor selection (`a.north → b.south`) isn't surfaced; all
  edges currently run center-to-center via cetz auto-clipping.
- Edge labels (`\draw (a) to node {$\phi$} (b);`-style) aren't supported
  yet — flag a TODO and emit a comment if you see them in legacy files.
- TODO: document the math-macro scoping limitation — `#let`-defined math
  bindings in main.typ aren't visible inside figure-file labels (Typst is
  lexically scoped); use `styles.typ` (or another shared module imported
  by both) as the home for shared `#let`s.

## Development notes

- The build has two modes that produce separate bundles: `--mode webview`
  (Preact UI for the custom editor's iframe) and `--mode extension` (Node
  entry point loaded by VS Code). `npm run build` runs both.
- TypeScript is strict and the project type-checks cleanly with
  `npx tsc --noEmit`.
- The parser is hand-rolled (`src/lib/CetzitParser.ts`) — Typst content
  blocks and dict literals make a tokenized grammar awkward. Round-tripping
  the canonical template is well-supported; arbitrary hand-edits may
  produce parse errors that surface as VS Code diagnostics.

## License

Inherits the original vstikzit license. See `LICENSE` (if present) or the
upstream repository at <https://github.com/tikzit/vstikzit>.
