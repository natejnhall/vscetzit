# Changelog

Local prompt-based log of substantive changes to cetzit. Newest first.

## `stroke: 2pt` renders as black, not invisible

> Setting a line style with `stroke: 2pt` creates an edge style
> that the gui displays as invisible.

`colorFromTypst` didn't recognise bare-length stroke shorthands.
In Typst, `stroke: 2pt` means "a 2pt stroke at the default
colour (black)" — but our parser fell through every branch and
returned the literal string `"2pt"`. SVG treats that as an
invalid stroke value and renders nothing, hence the
disappearing edge.

Added a length pattern check (`/^-?\d+(?:\.\d+)?\s*(?:pt|mm|cm|
em|in|px)$/i`) right after the `X + Ypt` shorthand stripper. A
match returns `"black"`, matching Typst's default. `black + 2pt`
already worked because the `+` shorthand stripped to the colour
side; this just fills in the bare-length gap.

## Cmd-C/V/X work in the node-label input

> I seem to be unable to copy and paste text in the label box
> for a node. Why? And can you fix it?

Root cause: VS Code intercepts cmd-C/V/X and routes them to the
`cetzit.gui.copy/cut/paste` commands before the webview's input
sees them. The when-clauses already guarded with `!inputFocus`,
but `inputFocus` is a built-in context that only tracks focus
inside VS Code's *own* inputs (not webview ones), so focusing
the label input didn't disable the shortcuts.

New plumbing:

- `CetzitHost.setLabelFieldFocused(focused)` on the host
  abstraction (no-op default; real impl in
  `CetzitExtensionHost` posts a `setLabelFieldFocused` message).
- `StylePanel.tsx`'s label `<input>` calls
  `host.setLabelFieldFocused(true/false)` on focus / blur.
- `editors.ts` handles the message by running
  `vscode.commands.executeCommand("setContext",
  "cetzit.labelFieldFocused", focused)`. The webview's
  `onDidDispose` also resets the context to `false` in case the
  blur event didn't fire before teardown.
- All 38 `cetzit.gui.*` keybindings in `package.json` now have
  `&& !cetzit.labelFieldFocused` appended to their `when`
  clauses. While the label input is focused, VS Code skips all
  cetzit shortcuts and the keystrokes fall through to the
  browser's default text-editing behaviour — so cmd-C / cmd-V /
  cmd-X / cmd-A / arrow keys all work as expected for editing
  the label.

## Selected nodes render on top of unselected ones

> It seems like newly pasted vertices (selected by default)
> aren't at the top layer. Clicking and dragging them moves the
> vertex beneath, if one exists. Make it so that any time a
> vertex is selected, it's on the top layer (if this is a
> copy-paste specific bug then patch that instead).

The `nodeLayer` `<g>` in `GraphEditor.tsx` rendered nodes in
`graph.nodes` iteration order. SVG z-order is render order, so
two nodes occupying the same spot competed by insertion order —
a freshly pasted node (auto-selected) sitting on top of an
existing one still passed clicks through to whichever happened
to be later in `graph.nodes`.

Fix: render unselected nodes first, then selected nodes. Two
filtered `.map` passes inside the same `<g>` — keeps the layer
structure intact, just splits the order so the selected subset
always wins both visually and for pointer events. Not paste-
specific: any selection (click, lasso, paste, post-undo
restore) lifts the node to the top during the selection.

## Selection clear on vertex placement; cmd-Z restores selection

> If a vertex or vertices are selected and a new vertex is placed,
> the selected vertex should be de-selected. If the user then
> presses cmd-z to undo placement, the vertex or vertices should
> be re-selected so that the user doesn't have to redo it
> manually.

- `GraphEditor`: the vertex-mode placement branch now calls
  `updateSelection(new Set(), new Set())` immediately before
  `updateGraph(...)`. So the moment a new vertex appears, any
  previously selected vertices/edges are cleared.
- `FigureEditor`: new `selectionHistory` ref — a capped list of
  `{ content, selectedNodes, selectedEdges }` snapshots. Every
  commit (in `handleGraphChange`) pushes a snapshot pairing the
  PRE-change figure text (i.e. the text the user would rewind to
  via cmd-Z) with the selection that was active at that moment.
- On every external update (`tryParseGraph` fires from a
  cmd-Z/cmd-Y text-edit revert), we scan the history for a
  content match. If found, we restore that snapshot's selection
  (filtered against `g.hasNode`/`hasEdge` so a hand-edit
  removing a node doesn't blow up). The history isn't sliced on
  match — keeping future-side entries lets cmd-Y reuse the same
  machinery to restore the post-redo selection.
- Snapshot machinery is generic: any commit benefits, not just
  vertex placement. Undoing a drag, a label edit, an edge add,
  etc. all restore whatever selection was active right before
  that change.

## Barrel writes through the editor buffer; self-heal watcher catches drift

> Subsequent attempts to rename don't yield a popup, but the
> function import in the barrel file doesn't update, it says
> `#import fig2.typ: fig1`. Your fix doesn't seem to be taking
> effect. […]
>
> Here's what I think is going on: the barrel file isn't
> updating if there is an unresolved import error in the file.
> If I reload it from scratch, it generates the barrel file
> perfectly. But if I rename a file, the barrel file updates the
> function name within the file first, then the path second,
> creating an unresolved import error, which then causes the
> update to the function name not to take effect.

The user's analysis was essentially correct, but the exact
mechanism is buffer-vs-disk, not parse error: our regenerate was
writing the new barrel via `vscode.workspace.fs.writeFile`, which
updates the on-disk file but bypasses any open editor buffer. If
the barrel was open, Tinymist's async "update imports on file
rename" feature applied its (partial) edit to the buffer AFTER
our disk write, leaving the buffer dirty with
`#import "newname.typ": oldname`. VS Code then either auto-
reloaded the disk content (good), prompted "file changed
externally" (the user might "keep mine"), or held the dirty
buffer until the user saved it — overwriting our correct disk
content with Tinymist's stale binding.

Two changes in `scaffold.ts`:

**Write through `WorkspaceEdit`, not `fs.writeFile`.** Split
`regenerateBarrelFile` into `buildBarrelContent` (pure: returns
the expected string) and `applyBarrelContent` (handles the
write). The apply path now opens the barrel as a
`TextDocument`, applies a full-range `WorkspaceEdit.replace`,
and saves. Falls back to `fs.writeFile` only if the document
can't be opened. Skips the write entirely if the buffer already
matches expected content — avoids triggering the self-heal
watcher (below) for no-op writes.

**Self-heal watcher.** New `onDidChangeTextDocument` listener
that fires on any edit to the barrel buffer, debounces 400ms
(both to collapse keystroke bursts and to give async LSP edits
time to settle), then runs a structural drift check. The drift
check parses every `#import "<path>": <binding>` line and
compares the bindings against `sanitizeFuncName(basename(path,
".typ"))` and the set of paths against `listFigureFiles`. Any
mismatch triggers a regenerate. No loop risk — our regenerate
produces drift-free content, so the next change event resolves
to "no drift" and stops.

The two together mean: any edit Tinymist (or anything else)
makes to the barrel that leaves it inconsistent with the figures
directory gets corrected within ~400ms, regardless of whether
the edit went through the buffer or the disk.

## Mode switch clears selection; vertex mode supports drag-to-move

> in the same way that switching modes should un-select the
> control point interface, changing mode should also un-select any
> currently selected vertices. Also, I should be able to
> click-and-drag a node in vertex mode.

**Mode switch clears selection.** The three handleCommand cases
(`cetzit.gui.selectTool`, `nodeTool`, `edgeTool`) and the Toolbar
`onToolChanged` callback in `FigureEditor` now call
`updateSelection(new Set(), new Set())` after the `setTool` call.
Smart-tool switches (right-click gestures that flip mode mid-
gesture) bypass these code paths — they call `setTool` directly
inside `handlePointerDown` — so transient mode flips during a
gesture preserve selection. Only an explicit user-initiated mode
change clears.

**Vertex-mode drag.** Pointer-down on a node in vertex mode now
sets `draggingNodes` and single-selects the node (mirroring select
mode's drag setup). Pointer-move applies the translation in real
time via `prevGraph.mapNodeData`. Pointer-up commits the move if
there was movement, or single-selects the node if there wasn't
(matching select-mode's no-movement-on-drag behaviour). The
existing semantics are preserved otherwise:

- Click on empty + no movement → place a new vertex (unchanged).
- Click-drag on empty → no-op, same "user mistake" behaviour as
  before.
- Right-click on a node → smart-tool to edge mode (unchanged;
  runs before the new vertex-mode branch).
- Double-click on a node → label editor (unchanged; the new
  single-click branch leaves the node selected so the double-
  click handler still finds the right target).

## Rename robustness: popup queue, delayed regen, subdir invariance

> The barrel file is not re-importing the functions and the listener
> is not renaming the functions within the files themselves if the
> rename happens within a subdirectory. […] Renaming functionality
> should happen identically regardless of which subdirectory I am
> in. […] When a file rename occurs, provide the popup. There also
> seems to be an issue with the popup in that if I rename a
> different file before dealing with the first popup, the popup
> gets overwritten and I lose the opportunity to rename instances
> of the function use in the main document. Fix this too — have
> popups persist.

Three pieces, all in `scaffold.ts`.

**Popup queue.** VS Code's `showInformationMessage` nominally
persists until clicked, but only ONE toast is visible at the
bottom-right at a time — newer toasts push older ones into the
(easily-missed) notification centre, so a rapid sequence of
renames looked like "the popup got overwritten" from the user's
POV. New `enqueuePrompt(task)` chains every rename prompt onto a
single `Promise` chain so each one awaits the previous before
showing. Users see one popup at a time and can address each in
order.

**Delayed barrel regenerate to win the Tinymist race.** Tinymist's
"update imports on file rename" LSP feature applies its edits
asynchronously and can land AFTER our immediate regenerate,
producing the half-applied `#import "newname.typ": oldname` line.
New `scheduleBarrelRegenerate(workspaceRoot, 600ms)` debounces a
deferred second write per workspace — by ~600ms later all LSP
edits have settled, and the second regenerate overwrites them.
Called from `handleFigureRenames` on every relevant rename, same
code path regardless of subdirectory depth.

**Error logging on failure paths.** `renameFunctionInFigure` now
emits a `console.warn` when its `#let <oldFunc>(` regex doesn't
match the file content (the rewrite is silently skipped, which
otherwise looks like the handler ran but nothing changed) and
`console.error` when `openTextDocument` / `applyEdit` / `save`
throw. These surface in the webview devtools console (Help →
Toggle Developer Tools in the host window) so legitimate
failures can be diagnosed without speculative fixes. No
info-level logging on the success path — these only fire when
something actually broke.

## Barrel handles subdirectories; rename overwrites Tinymist's partial edit

> I'd also like the barrel file to handle subdirectories well.
> Currently, if I move a file to a subdirectory, the barrel file
> handles it as a name change and it appears to work. But there
> seems to be an issue saving the result, since I think the
> listener for the barrel file doesn't scan the subdirectory and
> so there's a mismatch between the file contents and what the
> listener considers to be in the directory. Also, you fixed the
> function name to be updated within the file itself, but the
> import still isn't working in the barrel file. `#import
> "oldname.typ": oldname` becomes `#import "newname.typ": oldname`.

Two bugs, related.

**Subdirectory support.**
- `listFigureFiles` rewritten to walk the barrel's directory
  recursively. Returns relative paths with POSIX `/` separators
  (Typst's `#import` expects forward slashes regardless of host
  OS). Skips any file or directory whose name starts with `_` or
  `.` (tooling files like `_all.typ` and dot-dirs like `.git`).
  Result is sorted for stable diffs.
- The watcher's "is this file in the barrel dir?" check changed
  from `path.dirname === barrelDir` to a new `isUnderDir` helper
  that handles arbitrary nesting. Same exclusion for
  underscore/dot segments is applied so the watcher doesn't
  re-fire when a tooling file gets touched deep in a subdir.
- `regenerateBarrelFile` now derives the import binding from
  `path.posix.basename(rel, ".typ")` so a file at
  `figures/sub/foo.typ` still surfaces as `#import "sub/foo.typ":
  foo` — the user can call `#foo()` regardless of the path.
- Basename collisions across subdirs are detected: if two paths
  resolve to the same identifier, the barrel emits a
  `// WARNING:` comment listing the conflicting paths and
  explaining that Typst shadows earlier imports with later ones.
  We still emit every import line; the user picks the winner by
  renaming.

**Binding-name not updating on rename.**
- Root cause: Tinymist has a "update imports on file rename"
  LSP feature that rewrites the path string in importing files
  when a target gets renamed. It correctly updates the path
  (`"oldname.typ"` → `"newname.typ"`) but doesn't know about our
  barrel convention that the binding identifier should also
  match, so it leaves `: oldname` in place — producing
  `#import "newname.typ": oldname`, which is broken. Our
  filesystem watcher *should* have raced and overwritten that
  with a fresh regeneration, but with renames going through
  VS Code's UI the filesystem-level delete+create can be
  suppressed in favour of `onDidRenameFiles` alone.
- Fix: `handleFigureRenames` now explicitly calls
  `regenerateBarrelFile` after handling the in-file `#let`
  rewrite. This runs on every figure rename — including pure
  relocations into/within subdirs — and always overwrites any
  partial edit Tinymist may have applied.
- The handler also accepts a wider class of renames now:
  basename change, directory move within the tree, and
  move-in/move-out of the barrel dir. The in-file rewrite and
  usage prompt only fire when the basename (i.e. the identifier)
  actually changed AND the file still lives under the barrel
  tree; everything else is a pure path change covered by the
  barrel regeneration alone.

## Renaming a figure file updates its in-file function name

> If I rename a file (say, fig1.typ becomes fig3.typ) I want the
> function in the file to be updated accordingly. The barrel file
> updates the name of the file already, but not the function name.
> Change this too. Don't have the extension change the main
> document, but maybe add a popup asking if the user wants to
> change instances of fig1() to fig3().

- New `vscode.workspace.onDidRenameFiles` listener wired in
  `setupBarrelWatcher`. Only handles renames that BOTH start and
  end inside the barrel's directory and skips the barrel itself
  plus any underscore-prefixed file (tooling files like `_all.typ`
  are not figures).
- `renameFunctionInFigure` rewrites the `#let <oldFunc>(...)`
  line in the renamed file using a regex anchored on `#let` +
  whitespace + the exact identifier + `(`, so a stray comment or
  string containing the name isn't accidentally rewritten. Edit
  is applied via `WorkspaceEdit` + `applyEdit` so it composes
  with any open custom editor on the file, then saved.
- `maybePromptRenameUsages` scans the workspace for identifier-
  bounded `oldFunc` occurrences in all other `.typ` files
  (skipping the renamed file and the auto-regenerated barrel),
  collects ranges, and pops a "Replace N uses across M files? /
  Cancel" non-modal info message. On Replace, all hits are
  rewritten in a single `WorkspaceEdit` and saved. Identifier
  boundary uses `(?<![a-zA-Z0-9_-])` lookaround instead of `\b`
  because hyphens are valid in Typst identifiers but break `\b`.
- The user is never silently refactored — the file rename
  triggers ONE auto-edit (the figure's own `#let` line) and an
  optional opt-in for everything else.
- External renames (e.g. `mv` from a terminal) only trigger the
  filesystem watcher's delete+create pair, not the rename event;
  the barrel will regenerate but the in-file function stays
  stale. Tolerable for v1 — covers the common case of renaming
  in VS Code's explorer.

## Tighten double-click window from 400ms to 200ms

> make the time between clicks required to count as a "double click"
> shorter. Maybe cut it in half.

- `numClicks.current` reset timer in `handlePointerUp` cut from
  400ms to 200ms. Two intentionally separate clicks now have to
  be much closer in time to be fused into a double-click; the
  practical effect is that single-click actions (place vertex,
  start edge) feel more responsive in their commit/finalise phase
  because the editor isn't pessimistically waiting for a possible
  second tap.

## Canvas click after a label edit just commits the edit

> new fix: if the label text box is currently selected (i.e. I just
> finished typing a label) and I click on the canvas, nothing
> should happen. (i.e. no matter which mode we are in, clicking off
> of the label text box should behave as though we are in select
> mode).

- New `swallowGesture` ref in `GraphEditor`. At the top of
  `handlePointerDown`, if `document.activeElement` is an
  `HTMLInputElement`/`HTMLTextAreaElement`, the input is blurred,
  focus is moved to the SVG, the ref is set, and we return early
  — no `mouseDownPos`, no tool dispatch.
- `handlePointerMove` and `handlePointerUp` both early-out on the
  ref. Pointer-up also resets `numClicks.current = 0` and clears
  the ref so the *next* canvas click (which now starts with the
  SVG focused) gets the full tool treatment and isn't mis-counted
  as the second tap of a double-click.
- Why we needed this at all: pointer-down used to immediately call
  `event.currentTarget.focus()`, which blurs the input — but it
  did this in the same handler that goes on to place a vertex,
  start an edge, toggle bezier mode, etc. So a click meant only
  to leave the label field would simultaneously fire the active
  tool. The check has to happen *before* the SVG-focus call,
  since after it `document.activeElement` is already the SVG.

## Empty click in edge mode closes the CP interface

> I should also be able to empty click in edge mode while a control
> point is selected and have the control point interface go away.

- The edge-mode pointer-down's "else" branch (the catch-all that
  fires when the click didn't land on an edge or a CP handle)
  already cleared edge selection — but only when `clickedNode`
  was defined, i.e. only when the user was starting a new edge
  drag from a vertex. An empty-canvas click would also reach this
  branch but the `clickedNode !== undefined` guard kept the edge
  (and its CP overlay) selected.
- Dropped the guard. Any click that reaches the else branch is
  now a definite signal to deselect the current edge — either the
  user is starting a new edge gesture or just clicking off the
  current selection.

## Lift edge control-point handles into a top-most SVG layer

> It seems that if a label is in front of a control point thing on
> an edge, the mouse will try to click the label rather than a
> control point. When a control point interface is open, it should
> be at the highest click priority (at the "top level").

- Root cause: the draggable CP handle circles were rendered inside
  the `Edge` component, which sits in `edgeLayer`. `nodeLayer`
  renders after `edgeLayer`, so any node-label bounding box that
  overlapped a CP would intercept its click. SVG z-order is render
  order — the only fix is to render the handles later.
- Extracted the two handle circles into a new
  `EdgeControlHandles.tsx` component that re-runs
  `computeControlPoints` (one extra pure compute per selected edge —
  negligible) and emits just the two interactive circles.
- Added a new `<g id="controlPointLayer">` in `GraphEditor.tsx`
  that's rendered AFTER `nodeLayer`, iterates selected edges, and
  renders an `EdgeControlHandles` for each. Pointer-down on a
  handle still bubbles up to the SVG's master handler with
  `clickedControlPoint.current` set, so the existing
  drag/double-click logic is unchanged.
- Removed `onControlPointPointerDown` from `Edge`'s props and the
  now-dead handle-circle block from `Edge.tsx`. The cosmetic guide
  pieces (dashed radius circles + tangent lines) stay inside `Edge`
  since they already have `pointerEvents: none` and don't block
  anything regardless of layer.

## Spacebar + drag pans the canvas (and the half-speed bug)

> The trackpad is great, add shift and drag as well for pan.
>
> The dragging is quite jittery and doesnt seem to be moving as fast
> as my mouse, only half the distance. Is it only checking and
> updating half as often as the rest of the program?
>
> Also, upon second thought, since shift-click does something
> already, switch the gesture to spacebar-drag. Maybe this will also
> fix the problem.

- First pass used shift+drag and computed the pan delta in the
  SVG-relative coordinate system returned by `mousePositionToCoord`.
  That coordinate moves with the SVG: when we set `scrollLeft -= 50`,
  the SVG shifts +50 in viewport coords, so the *next* mouse event at
  the same screen position produces a `p` that already drifted by 50.
  Diffing that against the captured `mouseDownPos` under-counted the
  cursor delta by exactly the amount we'd just scrolled —
  algebraically a 1:0.5 feedback ratio, which matches the "half
  distance" symptom. The "jitter" is the same recurrence: the
  recurrence δₙ + δₙ₋₁ = −Mₙ alternates each event between catching
  up and stalling.
- Fix: diff in viewport-absolute coordinates. Pointer-down now stores
  `panStartClientX`/`panStartClientY` alongside the scroll offset,
  and pointer-move computes `event.clientX - panStartClientX`
  directly. `clientX`/`clientY` don't shift with our own scroll, so
  the delta is the true cursor motion.
- Switched the modifier from shift to spacebar. Shift+click is
  already overloaded by every tool (multi-select toggle, endpoint
  stickiness, etc.) so making it also a pan modifier was conflicting
  with the existing gestures.
- New `spaceHeld` ref in `GraphEditor`, plus a `useEffect` that
  registers window keydown/keyup for `code === "Space"`. The
  keydown is gated on the graph-editor element (or a descendant)
  being the active element so pressing space while typing in the
  style-panel label field still inserts a literal space.
  preventDefault on keydown avoids the webview scrolling.
- Pointer-down: `event.button === 0 && spaceHeld.current` enters
  pan mode and stamps the four start values. Pointer-move:
  early-out with the viewport-coord scroll update. Pointer-up:
  early-out only if `mouseMoved` was set — a space+click without
  drag still falls through to the tool's normal click semantics.
- The rubber-band setup in the select-tool's empty-click branch is
  suppressed when space is held, so the two gestures can't overlap.

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
