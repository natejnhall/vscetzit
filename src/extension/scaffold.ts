import * as vscode from "vscode";
import * as path from "path";

// Workspace scaffolding.
//
// The cetzit runtime library (`cetzit.typ`) is expected to live at the
// workspace root alongside `main.typ`. Users obtain it out-of-band (download
// from the distribution, copy from the extension bundle) and place it in the
// project themselves. We do NOT auto-write it on figure open. The extension
// still ships a bundled copy under `extensionUri/cetzit.typ` so the explicit
// "Scaffold cetzit project" command can drop a fresh copy into the workspace
// for users who want one.
//
// `styles.typ` is user-owned. For now it's auto-created on first figure open
// if missing (a popup will replace this in a follow-up).

const DEFAULT_STYLES = `// styles.typ — user-owned style definitions for cetzit figures.
//
// Each style is a Typst dict bound with \`#let\`. Reference it from a figure
// node or edge by its bare name (no quotes):
//
//   (name: "a", pos: (0, 0), style: my-style)
//
// Style fields (merged over the defaults in cetzit.typ; omit to inherit):
//
//   shape:           "pill" | "rectangle" | "circle" | "polygon" | "path"
//   fill:            color   — e.g. rgb(221, 255, 221), black, none
//   stroke:          stroke  — e.g. black + 1pt, none,
//                              (paint: red, thickness: 0.6pt, dash: "dashed")
//   size:            number  — cm; fixed size for circle, floor elsewhere
//   min-width:       number  — cm; bounding-box width floor
//   min-height:      number  — cm; bounding-box height floor
//   inner-sep:       number  — cm; padding around the rendered label
//   corner-radius:   number  — cm; for shape: "rectangle"
//   sides:           integer — for shape: "polygon" (3 = triangle, 6 = hexagon)
//   vertices:        array   — for shape: "path"; (x, y) tuples, any range
//   label-fill:      color   — color of the label text
//   unlabeled-style: dict    — overrides applied when the node has no label
//
// Edge styles use \`stroke\` (and, once implemented, \`mark-end\` / \`mark-start\`).
//
// Uncomment the examples below or define your own. The GUI's style panel
// will list whatever it finds in this file.

// #let z-spider = (
//   shape: "pill",
//   fill: rgb(221, 255, 221),
//   stroke: black + 0.4pt,
//   min-width: 0.5,
//   min-height: 0.5,
//   unlabeled-style: (shape: "circle", size: 0.25),
// )

// #let x-spider = (
//   shape: "pill",
//   fill: rgb(255, 221, 221),
//   stroke: black + 0.4pt,
//   min-width: 0.5,
//   min-height: 0.5,
// )

// #let hadamard-edge = (
//   stroke: (paint: blue, dash: "dashed"),
// )
`;

async function fileExists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

function stylesUri(workspaceRoot: vscode.Uri): vscode.Uri {
  const rel =
    vscode.workspace.getConfiguration("cetzit").get<string>("stylesFile") ?? "styles.typ";
  return vscode.Uri.file(path.join(workspaceRoot.fsPath, rel));
}

function libUri(workspaceRoot: vscode.Uri): vscode.Uri {
  return vscode.Uri.file(path.join(workspaceRoot.fsPath, "cetzit.typ"));
}

function barrelRelative(): string {
  const rel =
    vscode.workspace.getConfiguration("cetzit").get<string>("barrelFile") ?? "figures/_all.typ";
  return rel;
}

// Returns the URI of the barrel file, or undefined if the setting is empty
// (the user has disabled the barrel feature).
export function barrelUri(workspaceRoot: vscode.Uri): vscode.Uri | undefined {
  const rel = barrelRelative();
  if (!rel) return undefined;
  return vscode.Uri.file(path.join(workspaceRoot.fsPath, rel));
}

// Converts a figure file's basename into a valid Typst identifier (used as
// both the wrapper-function name in the figure file and the imported name in
// the barrel). Mirrors the logic in editors.ts; exported so both call sites
// share the same sanitisation.
export function sanitizeFuncName(basename: string): string {
  let name = basename.replace(/[^a-zA-Z0-9_-]/g, "-");
  if (/^[0-9]/.test(name)) name = "f-" + name;
  if (name === "") name = "figure-content";
  return name;
}

// Session-scoped record of workspaces we've already prompted in this VS Code
// session. Reset on extension reload so users always see the popup at least
// once per session if their styles file goes missing.
const promptedWorkspaces = new Set<string>();
const promptedBarrelWorkspaces = new Set<string>();

// Called from the figure editor on open. If the workspace already has a
// styles file, no-op. Otherwise prompt the user with a Create/Cancel popup;
// on Create, write the commented template. On Cancel (or dismissal) the
// figure editor still opens but Tinymist will error against the missing
// import until a styles file exists.
export async function maybePromptForStylesFile(
  _context: vscode.ExtensionContext,
  workspaceRoot: vscode.Uri
): Promise<void> {
  const styles = stylesUri(workspaceRoot);
  if (await fileExists(styles)) return;

  const key = workspaceRoot.toString();
  if (promptedWorkspaces.has(key)) return;
  promptedWorkspaces.add(key);

  const choice = await vscode.window.showInformationMessage(
    `cetzit: no ${
      vscode.workspace.getConfiguration("cetzit").get<string>("stylesFile") ?? "styles.typ"
    } found in this workspace. Create one?`,
    { modal: false },
    "Create",
    "Cancel"
  );

  if (choice === "Create") {
    try {
      await vscode.workspace.fs.writeFile(styles, Buffer.from(DEFAULT_STYLES, "utf8"));
    } catch (e) {
      vscode.window.showErrorMessage(`cetzit: failed to create styles file — ${e}`);
    }
  }
}

// Reads the workspace's styles file (path is configurable). Returns empty
// strings if the workspace has no styles file yet.
export async function readStylesFile(
  workspaceRoot: vscode.Uri
): Promise<{ filePath: string; content: string }> {
  const styles = stylesUri(workspaceRoot);
  try {
    const bytes = await vscode.workspace.fs.readFile(styles);
    return { filePath: styles.fsPath, content: Buffer.from(bytes).toString("utf8") };
  } catch {
    return { filePath: styles.fsPath, content: "" };
  }
}

// Explicit "scaffold this project" command. Drops a fresh copy of cetzit.typ
// at the workspace root (overwriting any existing copy), and silently creates
// the commented styles template if absent (no popup — the user invoked this
// command and clearly wants the files).
export async function scaffoldProject(context: vscode.ExtensionContext): Promise<void> {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    vscode.window.showWarningMessage("cetzit: open a workspace folder first.");
    return;
  }
  const folder = folders[0].uri;
  const libDest = libUri(folder);
  const libSource = vscode.Uri.joinPath(context.extensionUri, "cetzit.typ");

  try {
    const data = await vscode.workspace.fs.readFile(libSource);
    await vscode.workspace.fs.writeFile(libDest, data);
  } catch (e) {
    vscode.window.showErrorMessage(`cetzit: failed to copy cetzit.typ — ${e}`);
    return;
  }

  const styles = stylesUri(folder);
  const stylesCreated = !(await fileExists(styles));
  if (stylesCreated) {
    try {
      await vscode.workspace.fs.writeFile(styles, Buffer.from(DEFAULT_STYLES, "utf8"));
    } catch (e) {
      vscode.window.showErrorMessage(`cetzit: failed to create styles file — ${e}`);
    }
  }

  vscode.window.showInformationMessage(
    `cetzit: wrote cetzit.typ${
      stylesCreated
        ? ` and created ${
            vscode.workspace.getConfiguration("cetzit").get<string>("stylesFile") ?? "styles.typ"
          }`
        : ""
    } in ${folder.fsPath}`
  );
}

//----------------------------------------------------------------------
// Figure barrel file
//----------------------------------------------------------------------
//
// The barrel re-exports every figure function in its directory so users can
// `#import "/figures/_all.typ": *` once in main.typ instead of importing each
// figure separately. The cetzit extension auto-maintains it: a Create/Cancel
// popup the first time a figure is opened in a workspace that lacks one, and
// a workspace file watcher that regenerates the barrel whenever a figure is
// added, removed, or renamed.

// Returns true iff `filePath` lives anywhere under `dir` (recursively).
// Same-dir match counts; sibling/parent paths don't.
function isUnderDir(filePath: string, dir: string): boolean {
  const rel = path.relative(dir, filePath);
  if (rel === "" || rel === ".") return false;
  return !rel.startsWith("..") && !path.isAbsolute(rel);
}

// Walks the barrel's directory recursively and returns the relative paths
// (always using forward slashes — Typst's `#import` expects POSIX-style
// paths) of every `*.typ` file we should re-export. Skips:
//   - the barrel file itself
//   - any file or directory whose name starts with `_` (tooling files like
//     `_all.typ`, plus reserved scratch dirs like `_drafts/`)
//   - any dot-directory (e.g. `.git/`)
// Returned list is sorted for stable diffs across regenerations.
async function listFigureFiles(barrel: vscode.Uri): Promise<string[]> {
  const barrelDir = path.dirname(barrel.fsPath);
  const barrelName = path.basename(barrel.fsPath);
  const out: string[] = [];

  const walk = async (relDir: string): Promise<void> => {
    const absDir = vscode.Uri.file(path.join(barrelDir, relDir));
    let entries: [string, vscode.FileType][];
    try {
      entries = await vscode.workspace.fs.readDirectory(absDir);
    } catch {
      return;
    }
    for (const [name, type] of entries) {
      const childRel = relDir ? `${relDir}/${name}` : name;
      if (type === vscode.FileType.Directory) {
        if (name.startsWith("_") || name.startsWith(".")) continue;
        await walk(childRel);
      } else if (type === vscode.FileType.File) {
        if (!name.endsWith(".typ")) continue;
        if (name.startsWith("_")) continue;
        if (relDir === "" && name === barrelName) continue;
        out.push(childRel);
      }
    }
  };

  await walk("");
  out.sort();
  return out;
}

// Writes the barrel file based on whatever figures currently exist under
// its directory (recursively). The barrel uses the same
// name-from-basename convention as the figure emitter, so the imported
// identifier always matches the figure's `#let <name>(...)` regardless of
// which subdirectory the file sits in.
//
// Two files with the same basename in different subdirectories produce two
// `#import` lines binding the same identifier — the second shadows the
// first under Typst's normal scoping rules. We emit a `// WARNING:`
// comment in the barrel when this happens so the user can rename one
// rather than silently losing access.
export async function regenerateBarrelFile(workspaceRoot: vscode.Uri): Promise<void> {
  const barrel = barrelUri(workspaceRoot);
  if (!barrel) return;

  const figures = await listFigureFiles(barrel);

  const lines: string[] = [
    `// ${barrelRelative()} — auto-maintained by cetzit.`,
    "//",
    "// Re-exports every figure function under this directory (recursively)",
    "// so main.typ can import them all in one line:",
    "//",
    `//   #import "/${barrelRelative()}": *`,
    "//",
    "// Don't hand-edit — the cetzit extension regenerates this file when",
    "// figures are added, removed, moved, or renamed. Each figure's",
    "// function name is derived from its filename (the basename, sanitised",
    "// to a valid Typst identifier), so files in nested directories still",
    "// surface here under their bare basename.",
    "",
  ];

  // Detect basename collisions across subdirectories so we can flag them
  // to the user. We still emit every import line — the user can pick
  // which one wins by renaming.
  const byBasename = new Map<string, string[]>();
  for (const rel of figures) {
    const base = sanitizeFuncName(path.posix.basename(rel, ".typ"));
    const existing = byBasename.get(base);
    if (existing) existing.push(rel);
    else byBasename.set(base, [rel]);
  }
  for (const [name, paths] of byBasename) {
    if (paths.length > 1) {
      lines.push(
        `// WARNING: ${paths.length} figures resolve to the same name \`${name}\`: ${paths.join(", ")}.`,
        "// Typst will shadow earlier imports with later ones — rename one to disambiguate.",
        ""
      );
    }
  }

  for (const file of figures) {
    const funcName = sanitizeFuncName(path.posix.basename(file, ".typ"));
    lines.push(`#import "${file}": ${funcName}`);
  }

  const content = lines.join("\n") + "\n";
  try {
    await vscode.workspace.fs.writeFile(barrel, Buffer.from(content, "utf8"));
  } catch (e) {
    vscode.window.showErrorMessage(`cetzit: failed to regenerate barrel file — ${e}`);
  }
}

// Called from the figure editor on open. If the barrel feature is disabled
// (empty setting) or the barrel already exists, no-op. Otherwise prompt the
// user with a Create/Cancel popup. On Create, the barrel gets generated from
// whatever figures are currently in the directory.
export async function maybePromptForBarrelFile(
  _context: vscode.ExtensionContext,
  workspaceRoot: vscode.Uri
): Promise<void> {
  const barrel = barrelUri(workspaceRoot);
  if (!barrel) return;
  if (await fileExists(barrel)) return;

  const key = workspaceRoot.toString();
  if (promptedBarrelWorkspaces.has(key)) return;
  promptedBarrelWorkspaces.add(key);

  const choice = await vscode.window.showInformationMessage(
    `cetzit: create ${barrelRelative()} so main.typ can import every figure in one line?`,
    { modal: false },
    "Create",
    "Cancel"
  );

  if (choice === "Create") {
    await regenerateBarrelFile(workspaceRoot);
  }
}

// Set up a workspace file watcher that regenerates the barrel whenever a
// figure file is added or removed inside the directory the barrel lives in.
// Renames fire as a delete + create pair, so both are covered. We only
// regenerate if the barrel already exists — otherwise the user has either
// dismissed the popup or disabled the feature, and we shouldn't bring the
// file into being uninvited.
export function setupBarrelWatcher(context: vscode.ExtensionContext): void {
  const watcher = vscode.workspace.createFileSystemWatcher("**/*.typ");

  const maybeRegenerate = async (uri: vscode.Uri) => {
    const workspaceRoot = vscode.workspace.getWorkspaceFolder(uri)?.uri;
    if (!workspaceRoot) return;
    const barrel = barrelUri(workspaceRoot);
    if (!barrel) return;

    // Care about files anywhere under the barrel's directory (recursive).
    // The original top-level-only check missed files moved into
    // subdirectories — the barrel would lose the line entirely and we'd
    // end up with a stale "the file vanished" state.
    const barrelDir = path.dirname(barrel.fsPath);
    if (!isUnderDir(uri.fsPath, barrelDir)) return;

    // Skip tooling files (underscore-prefixed) and files inside an
    // underscore-prefixed subdirectory — those mirror the same exclusion
    // in `listFigureFiles` so the watcher doesn't re-fire pointlessly.
    const segments = path.relative(barrelDir, uri.fsPath).split(path.sep);
    if (segments.some(s => s.startsWith("_") || s.startsWith("."))) return;

    // Skip the barrel itself to avoid feedback loops on regeneration.
    if (uri.fsPath === barrel.fsPath) return;

    // Don't resurrect a barrel the user dismissed.
    if (!(await fileExists(barrel))) return;

    await regenerateBarrelFile(workspaceRoot);
  };

  watcher.onDidCreate(maybeRegenerate);
  watcher.onDidDelete(maybeRegenerate);
  // Content changes don't affect the barrel — only file presence does.

  context.subscriptions.push(watcher);

  // Rename hook: when the user renames a figure file (via VS Code's
  // explorer / F2), the barrel watcher above will re-emit the `#import`
  // line with the new basename automatically — but the `#let <name>(...)`
  // inside the file still bears the old name and won't match the new
  // import. Rewrite the in-file function name to match, and pop up a
  // prompt offering to update call-site usages workspace-wide.
  context.subscriptions.push(
    vscode.workspace.onDidRenameFiles(event => {
      void handleFigureRenames(event.files);
    })
  );
}

// Escape a string for safe interpolation into a RegExp source.
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Per-rename driver. Handles three orthogonal cases that can happen in a
// single rename event:
//
//   - basename change (e.g. fig1.typ → fig3.typ): rewrite the `#let` in
//     the renamed file and offer to update workspace-wide call sites.
//   - directory change within the barrel tree (e.g. figures/fig.typ →
//     figures/sub/fig.typ): no in-file edit, no usage prompt — the only
//     thing that changes is the path in the barrel's `#import` line.
//   - move INTO or OUT OF the barrel tree (e.g. other/fig.typ →
//     figures/fig.typ): no in-file edit (the file may never have had a
//     `#let` line), no usage prompt — the barrel just needs to gain or
//     drop the import.
//
// In all three cases we explicitly call `regenerateBarrelFile` at the
// end. The filesystem watcher's delete+create pair *might* also fire for
// renames, but in practice Tinymist's "update imports on file rename"
// feature can race us: it rewrites just the path string in the barrel's
// `#import` line (leaving the binding identifier stale), producing
// `#import "newname.typ": oldname` — a half-applied edit that breaks the
// import. Regenerating from this handler overwrites that with the
// correct line.
async function handleFigureRenames(
  files: ReadonlyArray<{ readonly oldUri: vscode.Uri; readonly newUri: vscode.Uri }>
): Promise<void> {
  for (const { oldUri, newUri } of files) {
    if (!newUri.fsPath.endsWith(".typ") || !oldUri.fsPath.endsWith(".typ")) continue;

    const workspaceRoot = vscode.workspace.getWorkspaceFolder(newUri)?.uri;
    if (!workspaceRoot) continue;

    const barrel = barrelUri(workspaceRoot);
    if (!barrel) continue;
    const barrelDir = path.dirname(barrel.fsPath);

    // At least one end must be in the barrel tree — a rename between two
    // unrelated workspace locations is none of our business.
    const oldUnder = isUnderDir(oldUri.fsPath, barrelDir);
    const newUnder = isUnderDir(newUri.fsPath, barrelDir);
    if (!oldUnder && !newUnder) continue;

    // Skip the barrel itself.
    if (newUri.fsPath === barrel.fsPath || oldUri.fsPath === barrel.fsPath) continue;

    // Skip tooling files (underscore-prefixed) at any depth.
    const skipSegment = (s: string) => s.startsWith("_") || s.startsWith(".");
    const oldSegs = oldUnder ? path.relative(barrelDir, oldUri.fsPath).split(path.sep) : [];
    const newSegs = newUnder ? path.relative(barrelDir, newUri.fsPath).split(path.sep) : [];
    if (oldSegs.some(skipSegment) || newSegs.some(skipSegment)) continue;

    const oldFunc = sanitizeFuncName(path.basename(oldUri.fsPath, ".typ"));
    const newFunc = sanitizeFuncName(path.basename(newUri.fsPath, ".typ"));
    const namesChanged = oldFunc !== newFunc;

    // Only rewrite the in-file `#let` if (a) the basename actually
    // changed, AND (b) the file still ends up inside the barrel tree.
    // Moving a figure OUT of the barrel dir doesn't trigger an in-file
    // rename — at that point the file is the user's to manage.
    if (namesChanged && newUnder) {
      await renameFunctionInFigure(newUri, oldFunc, newFunc);
    }

    // Regenerate the barrel deterministically. This overwrites any
    // partial edit Tinymist may have applied to the import line and
    // also covers subdirectory moves where the basename was stable.
    if (await fileExists(barrel)) {
      await regenerateBarrelFile(workspaceRoot);
    }

    // Only offer the workspace-wide rename when the *identifier* itself
    // changed. A pure relocation (subdir move) leaves call sites
    // correct, since they reference the identifier, not the path.
    if (namesChanged) {
      await maybePromptRenameUsages(workspaceRoot, oldFunc, newFunc, newUri);
    }
  }
}

// Rewrite the `#let <oldFunc>(` line in the renamed figure file to use the
// new function name. Applied via WorkspaceEdit so it composes cleanly with
// any open custom editor on the file.
async function renameFunctionInFigure(
  uri: vscode.Uri,
  oldFunc: string,
  newFunc: string
): Promise<void> {
  let doc: vscode.TextDocument;
  try {
    doc = await vscode.workspace.openTextDocument(uri);
  } catch {
    return;
  }
  const text = doc.getText();
  // Match the canonical signature emitted by Graph.cetzit():
  //   #let <name>(scale: 1.0) = cetzit-render(
  // We anchor on `#let` + whitespace + the exact identifier + `(` so we
  // don't accidentally rewrite a comment or string containing the name.
  const pattern = new RegExp(`(#let\\s+)(${escapeRegex(oldFunc)})(\\s*\\()`);
  const m = pattern.exec(text);
  if (!m || m.index === undefined) return;

  const idStart = m.index + m[1].length;
  const idEnd = idStart + oldFunc.length;
  const edit = new vscode.WorkspaceEdit();
  edit.replace(uri, new vscode.Range(doc.positionAt(idStart), doc.positionAt(idEnd)), newFunc);
  const ok = await vscode.workspace.applyEdit(edit);
  if (!ok) return;

  // Persist immediately so the file on disk reflects the rename even if
  // the user never opens it in the figure editor afterwards.
  const updated = await vscode.workspace.openTextDocument(uri);
  if (updated.isDirty) {
    await updated.save();
  }
}

// Scan the workspace for `oldFunc` call sites outside the renamed file and
// the (already auto-regenerated) barrel. If any exist, ask the user whether
// to replace them in a single undoable edit. We never replace silently —
// the user opted into a file rename, not a workspace-wide refactor.
async function maybePromptRenameUsages(
  workspaceRoot: vscode.Uri,
  oldFunc: string,
  newFunc: string,
  renamedUri: vscode.Uri
): Promise<void> {
  const barrel = barrelUri(workspaceRoot);

  // Identifier-bounded match — Typst identifiers allow letters, digits,
  // underscores, and hyphens, so we can't use \b (it treats `-` as a
  // boundary). Lookbehind/lookahead exclude those characters explicitly.
  const pattern = new RegExp(`(?<![a-zA-Z0-9_-])${escapeRegex(oldFunc)}(?![a-zA-Z0-9_-])`, "g");

  const files = await vscode.workspace.findFiles("**/*.typ");
  type Hit = { uri: vscode.Uri; ranges: vscode.Range[] };
  const candidates: Hit[] = [];

  for (const uri of files) {
    if (uri.fsPath === renamedUri.fsPath) continue;            // already rewrote
    if (barrel && uri.fsPath === barrel.fsPath) continue;       // auto-regenerated

    let doc: vscode.TextDocument;
    try {
      doc = await vscode.workspace.openTextDocument(uri);
    } catch {
      continue;
    }
    const text = doc.getText();
    const ranges: vscode.Range[] = [];
    let m: RegExpExecArray | null;
    pattern.lastIndex = 0;
    while ((m = pattern.exec(text)) !== null) {
      const start = doc.positionAt(m.index);
      const end = doc.positionAt(m.index + oldFunc.length);
      ranges.push(new vscode.Range(start, end));
    }
    if (ranges.length > 0) candidates.push({ uri, ranges });
  }

  if (candidates.length === 0) return;

  const total = candidates.reduce((n, c) => n + c.ranges.length, 0);
  const useWord = total === 1 ? "use" : "uses";
  const fileWord = candidates.length === 1 ? "file" : "files";
  const choice = await vscode.window.showInformationMessage(
    `cetzit: figure renamed ${oldFunc} → ${newFunc}. Replace ${total} ${useWord} across ${candidates.length} other ${fileWord}?`,
    { modal: false },
    "Replace",
    "Cancel"
  );
  if (choice !== "Replace") return;

  const edit = new vscode.WorkspaceEdit();
  for (const { uri, ranges } of candidates) {
    for (const r of ranges) edit.replace(uri, r, newFunc);
  }
  const ok = await vscode.workspace.applyEdit(edit);
  if (!ok) {
    vscode.window.showErrorMessage(`cetzit: failed to apply rename across workspace.`);
    return;
  }

  // Save each touched document so the change persists without requiring
  // the user to manually save every affected file.
  for (const { uri } of candidates) {
    try {
      const doc = await vscode.workspace.openTextDocument(uri);
      if (doc.isDirty) await doc.save();
    } catch {
      /* best-effort */
    }
  }
}
