// Helpers for reading cetzit style dicts whose values come straight from the
// styles.typ source text.
//
// Style values are stored as their raw Typst source — a `shape: "pill"` field
// is kept as the string `"pill"` (with quotes). These helpers unquote known
// string-typed fields and parse colors so the canvas can render an
// approximation of the figure.

import { StyleData } from "./Data";

function unquoteString(s: string | undefined): string | undefined {
  if (s === undefined) return undefined;
  const t = s.trim();
  if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) {
    return t.slice(1, -1);
  }
  return t;
}

// Returns the style's shape token ("circle", "rectangle", "pill", "polygon",
// "path"), or undefined if none is set. Pill is treated as rectangle for
// canvas hit-testing.
export function styleShape(style: StyleData): string | undefined {
  return unquoteString(style.property("shape"));
}

// Parses a Typst color expression to a CSS-ish color string. Handles:
//   - `rgb(r, g, b)` / `rgb(r%, g%, b%)`
//   - hex `#aabbcc`
//   - named colors (black/white/red/…)
//   - stroke shorthands like `black + 0.4pt` (returns the color part)
//   - dict-form `(paint: <color>, thickness: …, dash: …)` (returns `paint`)
export function colorFromTypst(expr: string | undefined): string | undefined {
  if (expr === undefined) return undefined;
  let s = expr.trim();
  if (s === "none") return "none";
  if (s === "") return undefined;

  // Dict form: `(paint: <color>, ...)`. Recurse on the paint value.
  if (s.startsWith("(") && s.endsWith(")")) {
    const dict = parseFlatDict(s.slice(1, -1));
    const paint = dict.get("paint");
    return paint !== undefined ? colorFromTypst(paint) : undefined;
  }

  // Strip `X + Ypt` stroke shorthand — keep the color side.
  const plus = topLevelPlus(s);
  if (plus !== -1) {
    s = s.slice(0, plus).trim();
  }

  // Bare-length stroke shorthand. In Typst `stroke: 2pt` means "use a
  // 2pt stroke at the default color" — black. Without this check the
  // function would fall through and return the literal `"2pt"` string,
  // which SVG treats as an invalid stroke and renders as invisible.
  if (/^-?\d+(?:\.\d+)?\s*(?:pt|mm|cm|em|in|px)$/i.test(s)) {
    return "black";
  }

  // Drop trailing color modifiers — we can't compute them on the canvas.
  s = s.replace(/\.(?:darken|lighten|transparentize|saturate|desaturate)\([^)]*\)$/, "");

  if (s.startsWith("#")) {
    return s;
  }

  const m = s.match(/^rgb\s*\((.*)\)$/);
  if (m) {
    const args = splitArgs(m[1]);
    if (args.length === 1 && args[0].startsWith('"')) {
      return args[0].slice(1, -1);
    }
    if (args.length >= 3) {
      const channels = args.slice(0, 3).map(a => parseChannel(a));
      if (channels.every(c => c !== undefined)) {
        const [r, g, b] = channels as number[];
        if (args.length === 4) {
          const alpha = parseChannel(args[3]) ?? 255;
          return `rgba(${r}, ${g}, ${b}, ${alpha / 255})`;
        }
        return `rgb(${r}, ${g}, ${b})`;
      }
    }
  }

  return NAMED_COLORS[s] ?? s;
}

// Minimal flat-dict parser for `key: value, key: value` text. Honors balanced
// (), [], {}, and quoted strings inside values.
function parseFlatDict(inner: string): Map<string, string> {
  const parts = splitArgs(inner);
  const out = new Map<string, string>();
  for (const part of parts) {
    if (part === "") continue;
    let depth = 0;
    let inStr = false;
    let colon = -1;
    for (let i = 0; i < part.length; i++) {
      const c = part[i];
      if (inStr) {
        if (c === "\\") i++;
        else if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') inStr = true;
      else if (c === "(" || c === "[" || c === "{") depth++;
      else if (c === ")" || c === "]" || c === "}") depth--;
      else if (c === ":" && depth === 0) {
        colon = i;
        break;
      }
    }
    if (colon < 0) continue;
    out.set(part.slice(0, colon).trim(), part.slice(colon + 1).trim());
  }
  return out;
}

function topLevelPlus(s: string): number {
  let depth = 0;
  let inStr = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (c === "\\") {
        i++;
      } else if (c === '"') {
        inStr = false;
      }
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (c === "+" && depth === 0) return i;
  }
  return -1;
}

function splitArgs(inner: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let inStr = false;
  let start = 0;
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (inStr) {
      if (c === "\\") {
        i++;
      } else if (c === '"') {
        inStr = false;
      }
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (c === "," && depth === 0) {
      parts.push(inner.slice(start, i).trim());
      start = i + 1;
    }
  }
  parts.push(inner.slice(start).trim());
  return parts;
}

function parseChannel(raw: string): number | undefined {
  const s = raw.trim();
  if (s.endsWith("%")) {
    const v = parseFloat(s.slice(0, -1));
    return isNaN(v) ? undefined : Math.round((v / 100) * 255);
  }
  const v = parseFloat(s);
  return isNaN(v) ? undefined : Math.round(v);
}

const NAMED_COLORS: Record<string, string> = {
  black: "#000000",
  white: "#ffffff",
  gray: "#808080",
  silver: "#c0c0c0",
  red: "#ff0000",
  green: "#008000",
  blue: "#0000ff",
  yellow: "#ffff00",
  cyan: "#00ffff",
  magenta: "#ff00ff",
  orange: "#ffa500",
  purple: "#800080",
  navy: "#000080",
  maroon: "#800000",
  olive: "#808000",
  teal: "#008080",
  lime: "#00ff00",
  fuchsia: "#ff00ff",
  aqua: "#00ffff",
};

// True if the style's `stroke` expression mentions a dash pattern. Handles
// `stroke: (paint: black, dash: "dashed")` and atom forms like `dashed`.
export function styleHasDash(style: StyleData, kind: "dashed" | "dotted"): boolean {
  if (style.hasKey(kind)) return true;
  const stroke = style.property("stroke");
  if (stroke && new RegExp(`dash\\s*:\\s*"${kind}"`).test(stroke)) {
    return true;
  }
  return false;
}
