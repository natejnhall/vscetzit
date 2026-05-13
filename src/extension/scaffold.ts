import * as vscode from "vscode";
import * as path from "path";

// Scaffolds the cetzit runtime + a starter styles file into the workspace
// when missing. The runtime ships with the extension under `cetzit/lib.typ`
// at the extension root; we copy it to `<workspace>/cetzit/lib.typ` so the
// figure file's `#import "/cetzit/lib.typ"` resolves.

const DEFAULT_STYLES = `// Auto-scaffolded by cetzit. Edit these named styles or add your own.
// Each style is a Typst dict; the cetzit GUI reads named styles from this
// file and writes them back when you edit them through the style editor.

#let z-spider = (
  shape: "pill",
  fill: rgb(221, 255, 221),
  stroke: black + 0.4pt,
  min-width: 0.5,
  min-height: 0.5,
)

#let x-spider = (
  shape: "pill",
  fill: rgb(255, 221, 221),
  stroke: black + 0.4pt,
  min-width: 0.5,
  min-height: 0.5,
)
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

// Scaffolds missing files in the workspace. `lib.typ` is treated as a
// vendored runtime owned by the extension — when `overwriteLib` is set we
// replace any existing copy with the bundled one. `styles.typ` is user-owned
// and never overwritten (only created if absent).
export async function ensureProjectScaffold(
  context: vscode.ExtensionContext,
  workspaceRoot: vscode.Uri,
  overwriteLib: boolean = false
): Promise<void> {
  const libDestDir = vscode.Uri.file(path.join(workspaceRoot.fsPath, "cetzit"));
  const libDest = vscode.Uri.file(path.join(workspaceRoot.fsPath, "cetzit", "lib.typ"));
  const styles = stylesUri(workspaceRoot);

  if (overwriteLib || !(await fileExists(libDest))) {
    try {
      await vscode.workspace.fs.createDirectory(libDestDir);
    } catch {
      // already exists
    }
    const libSource = vscode.Uri.joinPath(context.extensionUri, "cetzit", "lib.typ");
    try {
      const data = await vscode.workspace.fs.readFile(libSource);
      await vscode.workspace.fs.writeFile(libDest, data);
    } catch (e) {
      vscode.window.showErrorMessage(`cetzit: failed to scaffold lib.typ — ${e}`);
    }
  }

  if (!(await fileExists(styles))) {
    try {
      await vscode.workspace.fs.writeFile(styles, Buffer.from(DEFAULT_STYLES, "utf8"));
    } catch (e) {
      vscode.window.showErrorMessage(`cetzit: failed to scaffold styles file — ${e}`);
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

// Explicit "scaffold this project" command. Overwrites cetzit/lib.typ with
// the bundled version so users can pull in runtime updates without manual
// copying. styles.typ is left alone (user-owned).
export async function scaffoldProject(context: vscode.ExtensionContext): Promise<void> {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    vscode.window.showWarningMessage("cetzit: open a workspace folder first.");
    return;
  }
  const folder = folders[0].uri;
  await ensureProjectScaffold(context, folder, /* overwriteLib */ true);
  vscode.window.showInformationMessage(
    `cetzit: updated cetzit/lib.typ${
      (await fileExists(stylesUri(folder)))
        ? ""
        : ` and created ${
            vscode.workspace.getConfiguration("cetzit").get<string>("stylesFile") ?? "styles.typ"
          }`
    } in ${folder.fsPath}`
  );
}
