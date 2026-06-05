// Parser for cetzit-emitted Typst figure files and styles.typ files.
//
// Figure file shape (canonical, per CETZIT_LIB_CONTEXT.md):
//
//   #import "/cetzit.typ": *
//   #import "/styles.typ": *
//   #import "@preview/cetz:0.5.0"
//
//   #let fig1(scale: 1.0) = cetzit-render(
//     scale: scale,
//     cetz.canvas({
//       diagram(
//         nodes: (…),
//         edges: (…),
//       )
//     }),
//   )
//
// The figure file binds a function whose name matches the file's basename
// (sanitised to a valid Typst identifier). Users import it from main.typ and
// invoke with an optional `scale` (overloaded: ratio, number, or length).
// The parser only seeks the inner `diagram(` call — and requires an
// identifier boundary in front of it so matches inside larger identifiers
// like `cetzit-diagram(` aren't treated as the diagram args.
//
//   #align(center, cetz.canvas({
//     diagram(
//       nodes: (
//         (name: "a", pos: (0, 0), style: z-spider),
//         (name: "b", pos: (2, 0), style: x-spider, label: [Theorem @thm:foo]),
//       ),
//       edges: (
//         (source: "a", target: "b"),
//         (source: "a", target: "b", shape: (curve: "bend", bend: 30deg)),
//       ),
//     )
//   }))
//
// Style file shape:
//
//   #let z-spider = (
//     shape: "pill",
//     fill: rgb(221, 255, 221),
//     stroke: black + 0.4pt,
//     min-width: 0.5,
//   )
//
// The parser is hand-rolled rather than chevrotain-based: Typst's content
// blocks ([...]) and value variety make a tokenized grammar awkward.

import Graph from "./Graph";
import { Coord, EdgeData, GraphData, NodeData, PathData, StyleData } from "./Data";
import Styles from "./Styles";

class ParseError extends Error {
  public line: number;
  public column: number;
  public message: string;
  constructor(line: number, column: number, message: string) {
    super(message);
    this.line = line;
    this.column = column;
    this.message = message;
  }
}

// Determines whether a style is an edge-style based on the keys it carries.
// Node styles touch geometry (shape/size/fill/etc); edge styles only touch stroke.
const NODE_STYLE_KEYS = new Set([
  "shape",
  "fill",
  "size",
  "min-width",
  "min-height",
  "inner-sep",
  "corner-radius",
  "sides",
  "vertices",
  "label-fill",
  "unlabeled-style",
]);

function classifyStyle(map: Map<string, string | undefined>): "node" | "edge" {
  for (const k of map.keys()) {
    if (NODE_STYLE_KEYS.has(k)) {
      return "node";
    }
  }
  return "edge";
}

class Cursor {
  public readonly src: string;
  public pos: number = 0;

  constructor(src: string) {
    this.src = src;
  }

  get done(): boolean {
    return this.pos >= this.src.length;
  }

  peek(offset = 0): string {
    return this.src[this.pos + offset] ?? "";
  }

  startsWith(s: string): boolean {
    return this.src.startsWith(s, this.pos);
  }

  advance(n = 1) {
    this.pos += n;
  }

  lineCol(at: number = this.pos): { line: number; column: number } {
    let line = 1;
    let column = 1;
    for (let i = 0; i < at && i < this.src.length; i++) {
      if (this.src[i] === "\n") {
        line++;
        column = 1;
      } else {
        column++;
      }
    }
    return { line, column };
  }

  error(message: string, at: number = this.pos): ParseError {
    const { line, column } = this.lineCol(at);
    return new ParseError(line, column, message);
  }

  skipTrivia() {
    while (!this.done) {
      const c = this.peek();
      if (c === " " || c === "\t" || c === "\n" || c === "\r") {
        this.advance();
      } else if (c === "/" && this.peek(1) === "/") {
        while (!this.done && this.peek() !== "\n") {
          this.advance();
        }
      } else if (c === "/" && this.peek(1) === "*") {
        this.advance(2);
        while (!this.done && !(this.peek() === "*" && this.peek(1) === "/")) {
          this.advance();
        }
        if (!this.done) {
          this.advance(2);
        }
      } else {
        return;
      }
    }
  }

  match(s: string): boolean {
    if (this.startsWith(s)) {
      this.advance(s.length);
      return true;
    }
    return false;
  }

  expect(s: string) {
    if (!this.match(s)) {
      throw this.error(`Expected '${s}'`);
    }
  }

  // Read a balanced string up to (but not including) any of the stop chars at the
  // top level. Honors quoted strings, content blocks [...], parens, braces.
  readBalancedUntil(stops: Set<string>): string {
    const start = this.pos;
    while (!this.done) {
      const c = this.peek();
      if (stops.has(c)) {
        return this.src.slice(start, this.pos).trim();
      }
      if (c === '"') {
        this.skipString();
      } else if (c === "[") {
        this.skipBalanced("[", "]");
      } else if (c === "(") {
        this.skipBalanced("(", ")");
      } else if (c === "{") {
        this.skipBalanced("{", "}");
      } else {
        this.advance();
      }
    }
    return this.src.slice(start, this.pos).trim();
  }

  private skipString() {
    this.expect('"');
    while (!this.done) {
      const c = this.peek();
      if (c === "\\") {
        this.advance(2);
      } else if (c === '"') {
        this.advance();
        return;
      } else {
        this.advance();
      }
    }
    throw this.error("Unterminated string");
  }

  // Skips a balanced (...) / [...] / {...} pair, leaving the cursor just past the close.
  skipBalanced(open: string, close: string) {
    if (this.peek() !== open) {
      throw this.error(`Expected '${open}'`);
    }
    const start = this.pos;
    let depth = 0;
    while (!this.done) {
      const c = this.peek();
      if (c === '"') {
        this.skipString();
        continue;
      }
      if (c === open) {
        depth++;
        this.advance();
      } else if (c === close) {
        depth--;
        this.advance();
        if (depth === 0) {
          return;
        }
      } else if (c === "[" && open !== "[") {
        this.skipBalanced("[", "]");
      } else if (c === "{" && open !== "{") {
        this.skipBalanced("{", "}");
      } else if (c === "(" && open !== "(") {
        this.skipBalanced("(", ")");
      } else {
        this.advance();
      }
    }
    throw this.error(`Unbalanced '${open}'`, start);
  }

  // Reads a (...) group and returns its inner text.
  readGroup(open: string, close: string): string {
    if (this.peek() !== open) {
      throw this.error(`Expected '${open}'`);
    }
    const start = this.pos + 1;
    this.skipBalanced(open, close);
    return this.src.slice(start, this.pos - 1);
  }

  readIdentifier(): string | undefined {
    this.skipTrivia();
    const start = this.pos;
    while (!this.done) {
      const c = this.peek();
      if (
        (c >= "a" && c <= "z") ||
        (c >= "A" && c <= "Z") ||
        c === "_" ||
        c === "-" ||
        (this.pos > start && c >= "0" && c <= "9")
      ) {
        this.advance();
      } else {
        break;
      }
    }
    if (this.pos === start) {
      return undefined;
    }
    return this.src.slice(start, this.pos);
  }
}

// Splits the inside of a (...) / [...] / {...} group on top-level commas,
// honoring balanced delimiters.
function splitTopLevel(inner: string, sep: string = ","): string[] {
  const parts: string[] = [];
  const cur = new Cursor(inner);
  let lastStart = 0;
  while (!cur.done) {
    const c = cur.peek();
    if (c === '"') {
      (cur as any).skipString();
    } else if (c === "[") {
      cur.skipBalanced("[", "]");
    } else if (c === "(") {
      cur.skipBalanced("(", ")");
    } else if (c === "{") {
      cur.skipBalanced("{", "}");
    } else if (c === sep) {
      parts.push(inner.slice(lastStart, cur.pos).trim());
      cur.advance();
      lastStart = cur.pos;
    } else {
      cur.advance();
    }
  }
  const tail = inner.slice(lastStart).trim();
  if (tail !== "" || parts.length > 0) {
    parts.push(tail);
  }
  // Drop a trailing empty (from `,`-terminated lists)
  while (parts.length > 0 && parts[parts.length - 1] === "") {
    parts.pop();
  }
  return parts;
}

// Parses `key: value` pairs in a dict body. Values are kept as raw Typst text.
function parseDictBody(inner: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const part of splitTopLevel(inner, ",")) {
    if (part === "") continue;
    // Find first top-level colon.
    const cur = new Cursor(part);
    let colon = -1;
    while (!cur.done) {
      const c = cur.peek();
      if (c === '"') {
        (cur as any).skipString();
      } else if (c === "[") {
        cur.skipBalanced("[", "]");
      } else if (c === "(") {
        cur.skipBalanced("(", ")");
      } else if (c === "{") {
        cur.skipBalanced("{", "}");
      } else if (c === ":") {
        colon = cur.pos;
        break;
      } else {
        cur.advance();
      }
    }
    if (colon < 0) {
      // Bare key (atom) — store with empty string value to distinguish from absent.
      const k = part.trim();
      if (k !== "") {
        map.set(k, "");
      }
      continue;
    }
    const key = part.slice(0, colon).trim();
    const val = part.slice(colon + 1).trim();
    map.set(key, val);
  }
  return map;
}

function unquoteString(s: string): string {
  s = s.trim();
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) {
    return s
      .slice(1, -1)
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, "\\")
      .replace(/\\n/g, "\n")
      .replace(/\\t/g, "\t");
  }
  return s;
}

function unwrapContent(s: string): string {
  s = s.trim();
  if (s.startsWith("[") && s.endsWith("]")) {
    return s.slice(1, -1);
  }
  return s;
}

// Parses a numeric value like `1.5` or `-2` (no units).
function parseNumber(s: string): number | undefined {
  s = s.trim();
  const m = s.match(/^-?\d+(?:\.\d+)?$/);
  if (!m) return undefined;
  return parseFloat(s);
}

// Parses a value that's allowed to have a Typst unit suffix (deg, pt, etc.) and returns
// just the numeric magnitude. Useful for angles ("30deg") and lengths ("0.4pt").
function parseNumberWithUnit(s: string): number | undefined {
  s = s.trim();
  const m = s.match(/^(-?\d+(?:\.\d+)?)\s*[a-zA-Z%]*$/);
  if (!m) return undefined;
  return parseFloat(m[1]);
}

// Parses the body of `(x, y)` into a Coord. Returns undefined if it doesn't match.
function parseCoord(s: string): Coord | undefined {
  s = s.trim();
  if (!s.startsWith("(") || !s.endsWith(")")) return undefined;
  const inner = s.slice(1, -1);
  const parts = splitTopLevel(inner, ",");
  if (parts.length !== 2) return undefined;
  const x = parseNumberWithUnit(parts[0]);
  const y = parseNumberWithUnit(parts[1]);
  if (x === undefined || y === undefined) return undefined;
  return new Coord(x, y);
}

// Splits a top-level dict literal `(key: val, ...)` into a Map.
function parseDictLiteral(s: string): Map<string, string> | undefined {
  s = s.trim();
  if (!s.startsWith("(") || !s.endsWith(")")) return undefined;
  return parseDictBody(s.slice(1, -1));
}

// Drives the cursor through the figure file's preamble and lands at the `diagram(`
// call. Throws a ParseError if it can't find one.
//
// We require the match to be at an *identifier boundary* — i.e. the character
// before `diagram` must not itself be part of an identifier. This rules out
// false matches inside larger identifiers like `cetzit-diagram(` (the
// previous emitted wrapper) or `my-diagram(` (a user-supplied name).
function seekDiagramCall(cur: Cursor) {
  cur.skipTrivia();
  while (!cur.done) {
    if (cur.startsWith("diagram(")) {
      const prev = cur.pos > 0 ? cur.src[cur.pos - 1] : "";
      if (prev === "" || !/[a-zA-Z0-9_-]/.test(prev)) {
        cur.advance("diagram".length);
        return;
      }
    }
    cur.advance();
  }
  throw cur.error("Could not find 'diagram(' call in figure file");
}

function parseFigure(input: string): { result?: Graph; errors: ParseError[] } {
  const cur = new Cursor(input);
  try {
    // Empty/whitespace-only input is acceptable — return an empty graph.
    cur.skipTrivia();
    if (cur.done) {
      return { result: new Graph(), errors: [] };
    }

    seekDiagramCall(cur);
    cur.skipTrivia();
    const inner = cur.readGroup("(", ")");
    const args = parseDictBody(inner);

    let graph = new Graph();
    graph = graph.setGraphData(new GraphData());
    const nameToId = new Map<string, number>();

    const nodesRaw = args.get("nodes") ?? "()";
    const nodesInner = nodesRaw.trim();
    if (!nodesInner.startsWith("(") || !nodesInner.endsWith(")")) {
      throw cur.error("Expected nodes: (...) array");
    }
    const nodeParts = splitTopLevel(nodesInner.slice(1, -1), ",");
    for (const part of nodeParts) {
      const map = parseDictLiteral(part);
      if (!map) {
        throw cur.error("Expected node dict literal");
      }
      const name = unquoteString(map.get("name") ?? "");
      if (name === "") continue;
      const coord = parseCoord(map.get("pos") ?? "");
      if (!coord) {
        throw cur.error(`Node '${name}' has invalid 'pos' field`);
      }
      const id = graph.freshNodeId;
      nameToId.set(name, id);
      let d = new NodeData()
        .setId(id)
        .setCoord(coord)
        .setProperty("name", name);
      const styleVal = map.get("style");
      if (styleVal !== undefined && styleVal !== "" && styleVal !== "none-style") {
        d = d.setProperty("style", styleVal.trim());
      }
      const labelVal = map.get("label");
      if (labelVal !== undefined) {
        d = d.setLabel(unwrapContent(labelVal));
      }
      graph = graph.addNodeWithData(d);
    }

    const edgesRaw = args.get("edges") ?? "()";
    const edgesInner = edgesRaw.trim();
    if (!edgesInner.startsWith("(") || !edgesInner.endsWith(")")) {
      throw cur.error("Expected edges: (...) array");
    }
    const edgeParts = splitTopLevel(edgesInner.slice(1, -1), ",");
    for (const part of edgeParts) {
      const map = parseDictLiteral(part);
      if (!map) {
        throw cur.error("Expected edge dict literal");
      }
      const source = unquoteString(map.get("source") ?? "");
      const target = unquoteString(map.get("target") ?? "");
      const sId = nameToId.get(source);
      const tId = nameToId.get(target);
      if (sId === undefined) {
        throw cur.error(`Edge references unknown source node '${source}'`);
      }
      if (tId === undefined) {
        throw cur.error(`Edge references unknown target node '${target}'`);
      }

      let d = new EdgeData()
        .setId(graph.freshEdgeId)
        .setSource(sId)
        .setTarget(tId);

      const styleVal = map.get("style");
      if (styleVal !== undefined && styleVal !== "") {
        d = d.setProperty("style", styleVal.trim());
      }

      const shapeRaw = map.get("shape");
      if (shapeRaw !== undefined) {
        const shapeMap = parseDictLiteral(shapeRaw);
        if (shapeMap) {
          for (const [k, v] of shapeMap.entries()) {
            d = d.setProperty(k, v);
          }
        }
      }

      const pathId = graph.freshPathId;
      d = d.setPath(pathId);
      graph = graph.addEdgeWithData(d);
      graph = graph.addPathWithData(new PathData().setId(pathId).setEdges([d.id]));
    }

    return { result: graph, errors: [] };
  } catch (e) {
    if (e instanceof ParseError) {
      return { errors: [e] };
    }
    throw e;
  }
}

function parseStylesFile(input: string): { result?: Styles; errors: ParseError[] } {
  const cur = new Cursor(input);
  try {
    let styles = new Styles().addStyle(new StyleData().setName("none"));
    cur.skipTrivia();
    while (!cur.done) {
      // Skip `#import`/other directives.
      if (cur.startsWith("#let ")) {
        cur.advance("#let ".length);
        cur.skipTrivia();
        const name = cur.readIdentifier();
        if (!name) {
          throw cur.error("Expected identifier after #let");
        }
        cur.skipTrivia();
        cur.expect("=");
        cur.skipTrivia();
        if (cur.peek() !== "(") {
          // Non-dict #let — skip the rest of the statement.
          cur.readBalancedUntil(new Set(["\n"]));
          cur.skipTrivia();
          continue;
        }
        const dictText = cur.readGroup("(", ")");
        const map = parseDictBody(dictText);
        const id = styles.numStyles();
        let d = new StyleData().setId(id).setName(name);
        for (const [k, v] of map.entries()) {
          if (v === "") {
            d = d.setAtom(k);
          } else {
            d = d.setProperty(k, v);
          }
        }
        d = d.setKind(classifyStyle((d as any)._map));
        styles = styles.addStyle(d);
      } else {
        // Skip the rest of this line — could be `#import`, comment, etc.
        cur.readBalancedUntil(new Set(["\n"]));
      }
      cur.skipTrivia();
    }
    return { result: styles, errors: [] };
  } catch (e) {
    if (e instanceof ParseError) {
      return { errors: [e] };
    }
    throw e;
  }
}

// Validation helper retained for backwards compatibility with vstikzit GUI code.
// In cetzit, labels are Typst content — we accept anything with balanced [ ] braces.
function isValidDelimString(value: string): boolean {
  // value is wrapped as `{...}` by callers from the GUI for legacy reasons.
  let depth = 0;
  let escape = false;
  for (const c of value) {
    if (escape) {
      escape = false;
      continue;
    }
    if (c === "\\") {
      escape = true;
    } else if (c === "{") {
      depth++;
    } else if (c === "}") {
      depth--;
      if (depth < 0) return false;
    }
  }
  return depth === 0;
}

export {
  ParseError,
  parseFigure,
  parseStylesFile,
  isValidDelimString,
  classifyStyle,
};
