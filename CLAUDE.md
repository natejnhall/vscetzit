# CLAUDE.md — project context for vscetzit

A guide for future Claude sessions. Captures architecture, the format we
emit/parse, the conventions baked into the runtime library, and the design
decisions we landed on while porting from vstikzit. Keep this short and
authoritative; if something becomes stale, fix it.

## What this project is

VS Code extension that turns `.typ` figure files into a graph editor. The
on-disk format is a tiny domain-specific Typst template that calls a
`diagram(nodes: (...), edges: (...))` function from a runtime library at
`cetzit/lib.typ`. The GUI is a Preact webview that round-trips the file
through a hand-rolled parser and emitter.

Forked from vstikzit (https://github.com/tikzit/vstikzit). Most of the GUI
shell, the Graph data model, and the toolbar/keyboard plumbing are copied
verbatim. The format-specific parts (parser, emitter, symbol palette,
activation, scaffolding) are cetzit-specific.

## The on-disk format

Every figure file emitted by cetzit looks like:

```typst
#import "/cetzit/lib.typ": *
#import "/styles.typ": *
#import "@preview/cetz:0.5.0"

#align(center, cetz.canvas({
  diagram(
    nodes: (
      (name: "a", pos: (0, 0), style: z-spider),
      (name: "b", pos: (2, 0), style: x-spider, label: [Theorem @thm:foo]),
    ),
    edges: (
      (source: "a", target: "b"),
      (source: "a", target: "b", shape: (curve: "bend", bend: 30deg)),
    ),
  )
}))
```

Critical invariants:

- `name` on a node is a string. It's the user-visible identity; edges
  reference it from `source`/`target`. Internal numeric IDs (`d.id`) are
  reassigned by the parser on every reload and **must not** appear in the
  emitted output (the emitter falls back to `n<id>` only if a node has no
  stored `name` — see "Node naming" below).
- `pos` is `(x, y)` in CeTZ canvas units (1cm by default). Y increases
  upward — matches TikZ, opposite of SVG screen coords.
- `style` is a bare identifier referencing a `#let` in `styles.typ`. It
  is NOT a string. Quoting the style name is a parse error in Typst.
- `label` is wrapped in `[...]` (Typst content brackets). Math goes in
  `$...$` inside the brackets, or `[$alpha$]` for a one-glyph label.
- `shape: (...)` is a dict of geometric edge fields: `curve`, `bend`,
  `out-angle`, `in-angle`, `looseness`, `loop-angle`, `loop-spread`,
  `loop-size`. The emitter infers `curve` from which fields are populated
  (`bend → "bend"`, `in-angle/out-angle → "in-out"`, neither → omit so
  lib.typ defaults to `"line"`, self-loops omit it because lib.typ
  auto-detects `source == target`).

## The runtime library (`cetzit/lib.typ`)

The user's workspace has its own copy, scaffolded by the extension on first
figure-file open. The canonical version ships at the extension root. To
push updates: run **"cetzit: Scaffold cetzit project…"** — that command
overwrites `cetzit/lib.typ` but never touches `styles.typ`.

### Public API

- `node(pos, style: (:), label: none, name: none)` — places a CeTZ
  `content` element at `pos` registered as `name`. Empty-node case
  (`style == (:)` or `style == none-style`) is built-in and special: a
  zero-size anchor when unlabeled, a transparent pill-bounded label when
  labeled. The empty-node behavior cannot be overridden.
- `edge(source, target, positions: (:), style: (:), shape: (:))` — draws
  the line/curve. `positions` is a `name -> (x, y)` dict that `diagram()`
  builds; needed because cetz name-resolution doesn't reach into the
  control-point math.
- `diagram(nodes: (), edges: ())` — entry point. Builds the `positions`
  dict, draws edges first, nodes second. The ordering matters: edges
  appear to "clip" to node boundaries because nodes paint over them.

### Default styles

```typst
#let default-style = (
  shape: "pill",
  fill: none,
  stroke: none,
  size: 0.5,
  min-width: 0.5,
  min-height: 0.5,
  inner-sep: 0.1,
  corner-radius: 0.05,
  sides: 3,
  vertices: none,
  label-fill: black,
  unlabeled-style: none,
)

#let default-edge-style = (stroke: black + 1pt)

#let default-edge-shape = (
  curve: "line",
  bend: 0deg,
  out-angle: 0deg,
  in-angle: 180deg,
  looseness: 1.0,
  loop-angle: 90deg,
  loop-spread: 90deg,
  loop-size: 1.0,
)
```

### Shape branches

- `"rectangle"`, `"pill"` — Typst `rect()` body. Width and height grow to
  fit `max(min-*, label + 2·inner-sep)`. Pill has `radius: 100%`.
- `"circle"` — Typst `circle()` of size `s.size`. Fixed-size; does not grow
  with the label.
- `"polygon"` — Typst `polygon.regular(size, vertices)` body. Square. Side
  length grows to `max(size, min-width, min-height, label + 2·inner-sep)`.
- `"path"` — closed polyline through `s.vertices`, scaled into a square
  bbox. The polygon is positioned via `place(top + left, dx, dy, …)` so
  that the **centroid** lands at the bounding-box center. This matters
  because cetz attaches edges at the bbox center — without the centroid
  alignment, edges would hit asymmetric polygons off-centre.

### Self-loop conventions

`source == target` auto-detected. Control points sit at distance
`loop-size` from the source, at angles:

- cp1 (source-side, "out") = `loop-angle + loop-spread/2`
- cp2 (target-side, "in")  = `loop-angle − loop-spread/2`

Positive `loop-spread` ⇒ CW traversal in math frame. Defaults:
`loop-angle = 90°` (above), `loop-spread = 90°`, `loop-size = 1.0`.

## Architecture: where things live

```
src/
├── extension/
│   ├── extension.ts      activate(), command registration, GUI-command
│   │                     forwarding to the webview
│   ├── editors.ts        custom editor providers (figure + styles).
│   │                     Drives webview ↔ document round-trip.
│   └── scaffold.ts       writes cetzit/lib.typ + styles.typ on first
│                         open; overwrites lib.typ on explicit command
├── gui/                  Preact webview (one bundle: cetzit_vscode.js)
│   ├── CetzitExtensionHost.tsx  webview entry; bridges to VS Code via
│   │                             postMessage
│   ├── CetzitBrowserHost.tsx    standalone-browser entry (for `npm run
│   │                             preview-browser`); not shipped to users
│   ├── FigureEditor.tsx         the main figure editor view (canvas +
│   │                             style panel)
│   ├── StyleEditor.tsx          edits styles.typ
│   ├── GraphEditor.tsx          mouse + keyboard handling on the SVG
│   │                             canvas (largest file in the GUI)
│   ├── Node.tsx, Edge.tsx       SVG renderers
│   ├── StylePanel.tsx, Style.tsx  style palette + per-style editor
│   └── …                        Toolbar, Splitpane, Help, etc.
└── lib/
    ├── Data.ts           immutable Graph/NodeData/EdgeData/PathData/
    │                     StyleData primitives
    ├── Graph.ts          Graph operations + emitter (the `.cetzit()`
    │                     method produces the canonical figure template)
    ├── Styles.ts         Styles collection + emitter (#let blocks)
    ├── CetzitParser.ts   parses figure + styles files
    ├── CetzitHost.ts     abstract host (extends to webview vs browser)
    ├── curve.ts          bezier math for the SVG canvas
    ├── styleUtils.ts     helpers: unquote shape strings, parse Typst
    │                     color expressions, detect dash patterns
    ├── color.ts          tex color name table (legacy from vstikzit)
    ├── labels.ts         `sym.foo` / `math.NN` → Unicode glyph mapping
    ├── grid.ts           snap-to-grid math
    ├── commands.ts       help text + keyboard shortcuts
    └── SceneCoords.ts    canvas zoom/pan + screen↔scene coord conversion
```

## Design decisions worth knowing

### Names are user-visible; internal IDs are not

vstikzit used numeric node IDs everywhere because TikZ syntax allows them.
Cetzit nodes are identified by string `name`. Internal `d.id` is an
implementation detail: the parser assigns IDs 0..n-1 in file order, and
they get reshuffled on every reload. The emitter prefers
`d.property("name")` and only falls back to `n<id>` for nodes that somehow
lack a name. The vertex tool computes a non-colliding `n<k>` at creation
time so new nodes never inherit the unstable ID convention. See
`GraphEditor.tsx`'s `case "vertex":` branch.

### Edge `shape` keys round-trip via a flat property map

`EdgeData._map` stores edge keys flat (`bend`, `in-angle`, etc.). The
parser stores raw text (e.g. `"-120deg"`); the emitter strips a trailing
`deg` before re-appending it so the round-trip is idempotent. Don't trust
`propertyFloat` for round-tripping — it returns the leading number magnitude.
For values you'll re-emit, preserve the raw string.

### Bend sign convention

Cetzit uses **positive bend = CCW pivot of outAngle from source→target
bearing.** `lib.typ` implements `out-a = atan2(dy, dx) + bend` and
`in-a = π + atan2(dy, dx) − bend`. The GUI's `curve.ts` matches. This is
the opposite of vstikzit's inherited convention (where positive meant CW);
the migration was made during the cetzit port and you may see old commit
messages where the sign was inverted.

### Self-loop dragging

Each control point rotates around the node at the shared `loop-size`
radius, and `loop-size` updates from drag distance. The dragged cp's angle
is snapped to 15° (snapping the **cp angle itself**, not `loop-angle` and
`loop-spread` independently — independent snapping caused rounding errors
to shift the un-dragged cp in the opposite direction). The trade-off is
that `loop-angle` and `loop-spread` may be stored as fractional degrees;
Tinymist accepts them.

### Mouse modes

In **select mode**: right-click on a node opens the label editor (no
drag); right-click-drag from a node to another connects an edge;
right-click on empty places a node.

In **vertex mode**: left-click on empty places a node;
right-click on a node makes a self-loop (no drag) or an edge (with drag).

Smart-tool switching lives in `GraphEditor.tsx`'s `handlePointerDown`; the
`uiState.smartToolFrom` field disambiguates which tool we came from so
pointer-up knows whether a no-drag right-click on a node should open the
label editor (select-mode origin) or create a self-loop (vertex-mode origin).

### Approximations on the canvas

The webview canvas isn't a Typst engine. Several things are approximate:

- **Labels** render via a Unicode-glyph table in `labels.ts`. `sym.alpha`
  becomes `α`; complex content (math, mark-ups, fractions) renders as raw
  source.
- **Shapes**: `Node.tsx` collapses every non-circle shape to "rectangle"
  for hit-testing and visual approximation. Pills look like rectangles;
  polygons look like rectangles. This is intentional for v1 and listed
  under "Open improvements" in the README.
- **Sizing**: rect/pill node bodies in `lib.typ` use `context + measure`
  to compute their actual size from the rendered label. The canvas
  approximates with `min-width × min-height` and doesn't measure label
  glyph metrics.

For ground truth, the user keeps Tinymist's preview open alongside.

## Things to know about cetz vs. tikz

- CeTZ canvas defaults to 1cm/unit; vstikzit's `.tikz` files were
  unitless. Preserve raw numbers from the figure file rather than
  rescaling.
- No global `node distance` directive (TikZit positioned everything by
  absolute coord anyway, so not a regression).
- CeTZ is pinned to `0.5.0` in the import. Don't auto-bump.
- Tinymist watches the file and recompiles. No subprocess management
  needed; the extension only edits files via `vscode.WorkspaceEdit`.

## How to build / run

```bash
npm install
npm run build           # → dist/cetzit_vscode.{js,css} + dist/extension.js
npx tsc --noEmit        # strict type-check
```

Then F5 in VS Code (with this folder open as the workspace root) launches
an Extension Development Host. Reload that window with Cmd+R to pick up
new builds.

## Open improvements (mirror of README, expanded)

- **Style menu GUI**: surface `size`, `min-width`, `min-height`,
  `inner-sep`, `corner-radius`, `sides`, `label-fill`, `unlabeled-style`,
  and edge defaults. Probably ranged number inputs + a small color picker
  for `label-fill`, with `unlabeled-style` being a nested dict editor.
- **Polygon/pill rendering in the canvas**: add an SVG `<polygon>`
  branch in `Node.tsx` keyed off `styleShape(style)`. Compute regular
  polygon vertices from `sides`. Pills render as `rx="50%" ry="50%"` rects
  whose width grows with the label (approximate via character count
  rather than glyph measurement).
- **Directed edges**: extend `default-edge-style` in `lib.typ` with
  `mark-end` / `mark-start` (`"arrow"` | `"flat"` | `none`), implement
  with `cetz.draw.mark`. In the GUI, re-enable arrowhead computation
  paths in `Edge.tsx` (currently commented out) and add a dropdown in the
  edge-style editor. Update `Graph.ts` emitter to include `mark-*` in the
  emitted `style:` dict.
- **Typst symbol rendering**: replace `labels.ts` with a call to Tinymist
  for label preview, or compile to MathML/SVG inline. The current
  glyph-table covers most letters but misses formatting and composition
  (e.g. subscripts, fractions, multi-letter expressions).

## When working on this codebase

- The parser is forgiving but not magical. If the user hand-edits the
  figure into a shape that doesn't match the canonical template, expect a
  diagnostic. Don't extend the parser to swallow arbitrary Typst; instead,
  add the new syntax to the emitter and surface it as a structured field.
- `Graph.tikz()` / `Graph.tikzWithPosition()` are legacy aliases that call
  the cetzit emitter. Don't grep for "tikz" assuming it produces TikZ
  source — it doesn't anywhere in this codebase.
- The `default-style`/`default-edge-style` dicts in `lib.typ` are
  authoritative for runtime defaults. If you change them, update the
  CLAUDE.md table above too.
- CSS variables in `gui/vscodevars.css` are still namespaced `--tikzit-*`
  — this is intentional (cosmetic-only; renaming them would churn every
  inline-style consumer). Leave them alone unless you're doing a full
  pass.
