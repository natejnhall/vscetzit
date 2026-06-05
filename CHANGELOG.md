# Changelog

Local prompt-based log of substantive changes to cetzit. Newest first.

## Exclude underscore-prefixed `.typ` files from the figure editor glob

> Make sure `_all.typ` (and any other tooling-managed file with a
> leading underscore) isn't opened as a cetzit figure.

- `package.json`: the `customEditors` `filenamePattern` and the
  `cetzit.figureGlob` default both became
  `**/figures/**/[!_]*.typ`. The `[!_]` glob class means "first
  character of the filename is not `_`", so `_all.typ` (and any
  other `_*.typ` you put in `figures/`) is excluded from cetzit's
  custom editor and opens as plain text instead.
- Defense in depth: even if a user manually picks "Reopen With… →
  cetzit Figure Editor" for the barrel, the parser fails to find
  a `diagram(` call, the editor's `enabled` flag stays false, and
  the GUI's `updateFromGui` no-ops — so the barrel can't be
  accidentally overwritten with a figure template.

## Re-export attempt reverted — Typst rejects the cycle

> Tried adding `#import "/figures/_all.typ": *` inside `cetzit.typ`
> (bottom of file) so main.typ could import everything in one line.
> Tinymist errored with a circular module dependency and the change
> was rolled back.

- Removed the trailing barrel import from `cetzit.typ`. Figure
  files keep importing `cetzit.typ` for `cetzit-render` etc.;
  main.typ keeps two imports: one for cetzit primitives (if it
  needs them), one for the figure barrel.

```typst
#import "/cetzit.typ": *           // optional, for direct cetz primitives
#import "/figures/_all.typ": *     // pulls in every figure function
```

## Auto-maintained figure barrel file (`figures/_all.typ`)

> Same flow as the styles popup: when a figure is opened and there's
> no barrel, ask whether to create one. If created, keep it in sync
> as figures are added / removed / renamed so the user only needs
> `#import "/figures/_all.typ": *` once in main.typ.

- New setting `cetzit.barrelFile`, default `figures/_all.typ`. Empty
  string disables the feature.
- `scaffold.ts` gains:
  - `barrelUri(workspaceRoot)`, `sanitizeFuncName(basename)` (moved
    from `editors.ts` so it's shared with the barrel emitter).
  - `regenerateBarrelFile(workspaceRoot)` — scans the barrel's
    directory for `*.typ` files, sorts them, writes one
    `#import "<name>.typ": <funcName>` per line plus a header
    comment explaining the file is auto-maintained.
  - `maybePromptForBarrelFile(...)` — Create/Cancel popup, session-
    scoped memo so it fires at most once per workspace per session.
  - `setupBarrelWatcher(context)` — `workspace.createFileSystemWatcher`
    on `**/*.typ` that regenerates the barrel on add/delete inside
    the barrel's directory. Skips the barrel file itself (no
    feedback loops) and won't resurrect a barrel the user dismissed
    or removed.
- `editors.ts` calls `maybePromptForBarrelFile` from the figure
  editor's `initialContent` (fire-and-forget alongside the styles
  popup).
- `extension.ts` calls `setupBarrelWatcher` during activation.

Resulting `figures/_all.typ`:

```typst
// figures/_all.typ — auto-maintained by cetzit.
//
// Re-exports every figure function in this directory so main.typ can
// import them all in one line:
//
//   #import "/figures/_all.typ": *
//
// Don't hand-edit — the cetzit extension regenerates this file when
// figures are added, removed, or renamed. Each figure's function name
// matches its filename (sanitised to a valid Typst identifier), so
// renaming a figure file requires re-saving it through the GUI for the
// new function name to land inside the file.

#import "circuit.typ": circuit
#import "fig1.typ": fig1
#import "fig2.typ": fig2
```

User then writes one line in `main.typ`:

```typst
#import "/figures/_all.typ": *

#fig1()
#circuit(scale: 1.5)
```

## Vertex-mode mouse refinements

> Double-clicking quickly in vertex mode should place ONE vertex
> and open the label editor, not stack two vertices on top of each
> other. Click-and-drag on empty space should do nothing (likely a
> user who meant edge mode). Click-and-drag from a vertex still
> starts an edge via the existing smart-tool switch.

- `GraphEditor.tsx` vertex-case pointer-up:
  - On the second click of a double-click (within the existing 400ms
    window), skip the second vertex placement entirely. The first
    click's vertex is the closest node to the second click, so we
    select it and focus the label input.
  - If the pointer moved between down and up (`uiState.mouseMoved`),
    skip placement. The user dragged in vertex mode, presumably by
    mistake.
  - Single click with no movement still places a vertex as before.

The smart-tool switch from the prior vertex-mouse pass still routes
right-click-on-node through the edge case, so edge dragging from a
vertex is unaffected.

## Drop `align` parameter from emitted figure function

> The `align` parameter no longer makes sense now that figures are
> placed via function call rather than `#include`. Take it out.

- `cetzit-render` and the emitted `#let <name>(…)` signature both
  lose the `align` keyword. Function placement / alignment is now
  the calling document's responsibility (e.g. wrap the call in
  `#align(center, fig1())` if needed).
- Removed the `_typst-align` alias from `cetzit.typ` (no longer
  referenced).

## Filename-derived `#let`, `scale` + `align` params, parser identifier boundary

> Use the filename-derived function name (cleaner imports), rename
> `scale-factor` to `scale`, overload `scale` to accept a length
> interpreted as a target font size, default `align` to `center`,
> and fix the parser so it doesn't misread the wrapper-function
> identifier as a `diagram(` call.

- **cetzit.typ**: new `cetzit-render(body, scale, align)` helper.
  Pins internal text size to 11pt, then `_typst-scale(...)`s and
  `_typst-align(...)`s the body. Module-level aliases
  `_typst-scale = scale` and `_typst-align = align` preserve access
  to Typst's built-ins even though the figure function's parameters
  shadow them.

  `scale` is overloaded:
    * ratio (`150%`) — used directly
    * number (`1.5`) — coerced to ratio (150%)
    * length (`14pt`) — interpreted as a target font size; the
      figure scales by `scale / 11pt`. So `scale: 22pt` makes the
      diagram render at twice its 11pt-baseline size.

  `align` accepts any Typst alignment value; default is `center`.

- **Graph.ts** emitter writes:

  ```typst
  #let <basename>(scale: 1.0, align: center) = cetzit-render(
    scale: scale,
    align: align,
    cetz.canvas({
      diagram(
        nodes: (…),
        edges: (…),
      )
    }),
  )
  ```

  The function name is again the figure file's basename (sanitised
  to a valid Typst identifier).

- **CetzitParser.ts** `seekDiagramCall` now requires an identifier
  boundary in front of the match. Previously it would happily
  match the `diagram(` substring inside `cetzit-diagram(...)` (or
  any user-named `*-diagram(`), parse the wrapper-function's
  arguments as the diagram body, and return an empty graph — which
  presented as "the figure read but rendered nothing".

User workflow:

```typst
// main.typ
#import "figures/fig1.typ": *
#import "figures/fig2.typ": *

#fig1()                        // default 1× scale, centered
#fig1(scale: 1.5)              // 150%
#fig1(scale: 14pt)             // scale to render at 14pt font size
#fig1(align: right)            // right-aligned

#fig2(scale: 80%, align: left) // both at once
```

Tag references inside labels (`[Theorem @thm:foo]`) continue to
resolve against the calling document's scope.

## Fix: GUI canvas not refreshing on Cmd-Z to empty document

> Pressing Cmd-Z in the figure editor deleted text from the typst
> document, but the visible nodes stayed on the canvas.

- `CetzitExtensionHost.tsx`: the webview listener was checking
  `if (message.content && ...)` for every inbound message. Truthy
  test on the document content fails on the empty string, so when
  Cmd-Z undid all the way back to a blank document the GUI never
  re-parsed and the stale graph stayed rendered. Switched the
  three message cases (`updateToGui`, `tikzStylesContent`,
  `command`) to `message.content !== undefined`.
- `editors.ts`: wrapped `updateFromGui`'s body in try/finally so a
  thrown `applyEdit` (e.g. the document closing mid-write) can no
  longer leak `isUpdatingFromGui = true`. A stuck flag would have
  silently filtered out every subsequent document change forever,
  including undos.

## Popup memo session-scoped

> The popup didn't fire on a workspace that had been opened before.

- Switched the per-workspace popup memo from
  `context.workspaceState` (persistent) to a module-level `Set`
  (session-scoped). The user now sees the prompt at least once per
  VS Code session for any workspace missing `styles.typ`.

(An earlier draft of this change also auto-removed a leftover
`cetzit/lib.typ` from the previous scaffold layout. Reverted — the
extension shouldn't delete from the user's workspace without
consent.)

## Rename styles template example to `hadamard-edge`

> Aesthetic: rename the commented `dashed-edge` example to `hadamard-edge`
> with stroke `(paint: blue, dash: "dashed")`; keep the default 1pt
> thickness (no explicit thickness field).

- Updated the commented example in `scaffold.ts`'s `DEFAULT_STYLES`.

## Create/Cancel popup for missing `styles.typ`

> On first figure open with no styles file, show a popup asking to
> create one. Two options only — create or cancel. The created file
> should brief the user on every available style option via comments.

- `scaffold.ts`: replaced the auto-write `ensureProjectScaffold` with
  `maybePromptForStylesFile`, which shows a non-modal
  `showInformationMessage("…create one?", "Create", "Cancel")`. The
  prompt is fire-and-forget so the figure editor opens immediately.
- Memoised per-workspace via `context.workspaceState` so the user
  isn't re-prompted within the same session after cancelling.
- The new template documents every style field
  (`shape`, `fill`, `stroke`, `size`, `min-width`/`min-height`,
  `inner-sep`, `corner-radius`, `sides`, `vertices`, `label-fill`,
  `unlabeled-style`) plus an edge-stroke example, with `#let`
  definitions commented out so the user can uncomment what they
  want.
- The explicit `cetzit.scaffoldProject` command still creates
  `styles.typ` silently (the user invoked it; no popup needed).

## Rename runtime library to `cetzit.typ` at workspace root

> User manually places the runtime library at the top level alongside
> `main.typ`. Rename to `cetzit.typ` and update every code reference.

- Moved `cetzit/lib.typ` → `cetzit.typ` in both `projmain/` and `vscetzit/`.
- Emitter writes `#import "/cetzit.typ": *` in the figure preamble.
- `scaffold.ts`: dropped auto-copy of the runtime library on figure open.
  The explicit `cetzit.scaffoldProject` command still copies a fresh
  `cetzit.typ` from the extension to the workspace root.
- Updated `package.json` command title, parser doc comment,
  `index.html` sample, and all `lib.typ` mentions in source comments
  to `cetzit.typ`.

## Self-loop control points: shared radius, independent angles

> Changing the length of one cp changes the length of both, but changing
> the angle of one leaves the angle of the other fixed.

- `GraphEditor.tsx` self-loop drag handler: snaps **cp angle itself** to
  15° before back-computing `loop-angle` and `loop-spread`. Snapping
  the underlying params independently leaked rounding error to the
  un-dragged cp (visible as cp2 jumping in the opposite direction of
  the cp1 drag).
- Both cps share `loop-size`, which still tracks drag distance.

## Mouse-mode redesign for right-click

> Select mode: right-click node opens label editor. Vertex mode:
> right-click node makes a self-loop; right-click-drag makes an edge.

- Added `smartToolFrom: "select" | "vertex"` to UIState to remember
  which tool the right-click smart-switch came from.
- `handlePointerDown`: right-click on a node in either mode promotes
  to the edge tool. Right-click on empty in select mode promotes to
  the vertex tool. Right-click on empty in vertex mode no-ops.
- `handlePointerUp`'s edge branch: if `smartToolFrom === "select"` and
  the click landed on the same node with no drag, opens the label
  editor instead of creating a self-loop. All other paths keep their
  existing edge-creation behaviour.

## Node naming convention

> Standardize node names so they don't collide after a delete-and-add
> cycle. Currently new nodes get `n<id>` which collides with existing
> `n8` once enough nodes are added.

- Vertex tool now picks `n<k>` where `k` is the smallest non-colliding
  integer starting at `graph.numNodes`. The fresh node carries an
  explicit `name` property so the parser can preserve it across
  reloads (where internal IDs get reassigned from 0).

## Round-trip emitter idempotency: `degdeg`

> Adding any new edge to a figure that already has an edge with
> `in-angle`/`out-angle` properties corrupts the existing edge:
> `out-angle: -120deg` becomes `out-angle: -120degdeg`.

- `Graph.ts` emitter strips a trailing `deg` from stored angle values
  before re-appending it, so values written by either the GUI (plain
  numbers) or the parser (raw `-120deg`) round-trip cleanly.

- Bonus cleanup: rounded looseness product back to 1 decimal in
  `GraphEditor.tsx` so we don't store `1.7999999999999998` from IEEE
  arithmetic.

## Path-shape edge anchors at geometric centroid

> The anchor for edges on `path`-shape nodes doesn't sit at the
> geometric center of the shape.

- `cetzit.typ`: path branch normalises user-supplied vertices around
  their centroid, scales to fit `side / 2`, then wraps in a fixed
  `side × side` box and `place`s the polygon with an explicit `dx`/`dy`
  offset so the centroid lands at the box centre regardless of how
  lopsided the vertex extents are. Users can now write vertices in
  any coordinate system — cetzit normalises.

## Inner-sep for polygons

> Changing `inner-sep` on a polygon style entry doesn't affect the
> rendered size.

- Polygon (and path) branches in `cetzit.typ` now compute side length
  as `max(size, min-width, min-height, label_dim + 2·inner-sep)`,
  mirroring the rectangle/pill behaviour. Unlabeled nodes are
  unaffected (label dimensions are `0pt × 0pt`).

## Polygon node rendering: "Expected content, found array"

> Defining a polygon shape style errors with `Expected content,
> found array`.

- `cetzit.typ`: replaced `cetz.draw.polygon` and `cetz.draw.line`
  (both return cetz drawables) with Typst's built-in
  `polygon.regular(size, vertices, ...)` and `polygon(.. vertices)`
  (both return content). Composes cleanly with the existing
  `cetz.draw.content(pos, body, name: name)` wrapper.

## Self-loops in GUI, bends in Typst, double-click bezier

> Self-loops render in Typst but not the GUI. Bent edges render in
> the GUI but not Typst. Double-clicking control points doesn't
> toggle bezier mode.

- `curve.ts`: added an explicit self-loop branch that mirrors lib's
  `loop-angle / loop-spread / loop-size` math so the GUI draws a
  teardrop above the node.
- `Graph.ts` emitter: infers `curve: "bend"` (or `"in-out"`) when the
  relevant fields are populated but `curve` wasn't stored — without
  this, lib.typ defaulted to `"line"` and ignored bend values.
- `GraphEditor.tsx` double-click handler: switched from the legacy
  TikZ keys (`bend left`, `bend right`, `in`, `out`) to cetzit's
  (`bend`, `in-angle`, `out-angle`, plus an explicit `curve`).
- Bend sign convention flipped to match the spec
  (positive = CCW pivot of outAngle from source→target bearing).

## Cmd+Alt+T (view source) and Backspace (delete)

> `cmd+alt+t` doesn't switch to the raw `.typ` source. Backspace with
> a node selected doesn't delete it.

- Aligned the GUI handler and the keybinding both on
  `cetzit.gui.viewTikzSource` (legacy name kept inside the GUI's
  switch).
- `package.json`: added a `backspace` keybinding for `cetzit.gui.delete`
  alongside the existing `delete`. macOS's "delete" key emits
  `backspace` in VS Code — only `fn+delete` was hitting the original
  binding.

## Initial port from vstikzit

> The frontend should be identical except symbols render per Typst's
> `sym` library, and the backend exports the canonical cetzit
> figure template.

- Copied `src/` from `reference/vstikzit/` into `projmain/`.
- Replaced `TikzParser.ts` with a hand-rolled `CetzitParser.ts` that
  reads the canonical figure template and `styles.typ`.
- Rewrote `Graph.tikz()` and `Styles.tikz()` to emit the cetzit
  template format (the `tikz()` legacy method names still work but
  output cetzit syntax).
- Replaced `labels.ts`: maps Typst `sym.*` / `math.*` paths to
  Unicode glyphs for in-canvas approximation.
- New `styleUtils.ts` for shared helpers: unquote shape strings,
  parse Typst color expressions, detect dash patterns.
- Renamed host classes (`TikzitHost`, `TikzitExtensionHost`,
  `TikzitBrowserHost`) → `Cetzit*`.
- Rewrote `extension.ts` and `editors.ts`: registers
  `cetzit.figureEditor` for `.typ` files under `**/figures/**`,
  drops LaTeX-preview commands, lets Tinymist handle compilation.
- Added `scaffold.ts` to write `cetzit/lib.typ` and `styles.typ` into
  workspaces on first figure open.
