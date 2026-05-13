// Maps Typst `sym.*` identifiers to their rendered Unicode glyph for in-canvas
// display. The canvas is an approximation — Tinymist's preview is authoritative.

const symToUnicode: Record<string, string> = {
  "alpha": "α",
  "beta": "β",
  "gamma": "γ",
  "delta": "δ",
  "epsilon": "ε",
  "epsilon.alt": "ϵ",
  "zeta": "ζ",
  "eta": "η",
  "theta": "θ",
  "theta.alt": "ϑ",
  "iota": "ι",
  "kappa": "κ",
  "lambda": "λ",
  "mu": "μ",
  "nu": "ν",
  "xi": "ξ",
  "omicron": "ο",
  "pi": "π",
  "pi.alt": "ϖ",
  "rho": "ρ",
  "rho.alt": "ϱ",
  "sigma": "σ",
  "sigma.alt": "ς",
  "tau": "τ",
  "upsilon": "υ",
  "phi": "ϕ",
  "phi.alt": "φ",
  "chi": "χ",
  "psi": "ψ",
  "omega": "ω",

  "Alpha": "Α",
  "Beta": "Β",
  "Gamma": "Γ",
  "Delta": "Δ",
  "Epsilon": "Ε",
  "Zeta": "Ζ",
  "Eta": "Η",
  "Theta": "Θ",
  "Iota": "Ι",
  "Kappa": "Κ",
  "Lambda": "Λ",
  "Mu": "Μ",
  "Nu": "Ν",
  "Xi": "Ξ",
  "Omicron": "Ο",
  "Pi": "Π",
  "Rho": "Ρ",
  "Sigma": "Σ",
  "Tau": "Τ",
  "Upsilon": "Υ",
  "Phi": "Φ",
  "Chi": "Χ",
  "Psi": "Ψ",
  "Omega": "Ω",

  "plus.minus": "±",
  "minus.plus": "∓",
  "times": "×",
  "div": "÷",
  "dot.op": "·",
  "dot.c": "·",
  "bullet": "•",
  "circle.plus": "⊕",
  "circle.minus": "⊖",
  "circle.times": "⊗",
  "circle.slash": "⊘",
  "circle.dot": "⊙",
  "circle.small": "∘",
  "ast.op": "∗",
  "star.op": "⋆",
  "diamond.op": "⋄",
  "triangle.t": "△",
  "triangle.b": "▽",
  "square": "□",
  "square.filled": "■",
  "lozenge": "◊",

  "lt.eq": "≤",
  "gt.eq": "≥",
  "eq.not": "≠",
  "ident": "≡",
  "approx": "≈",
  "tilde": "∼",
  "tilde.eq": "≃",
  "tilde.equiv": "≅",
  "prop": "∝",
  "parallel": "∥",
  "perp": "⊥",
  "in": "∈",
  "in.not": "∉",
  "subset": "⊂",
  "supset": "⊃",
  "subset.eq": "⊆",
  "supset.eq": "⊇",
  "inter": "∩",
  "union": "∪",
  "without": "∖",
  "emptyset": "∅",

  "arrow.r": "→",
  "arrow.l": "←",
  "arrow.l.r": "↔",
  "arrow.r.double": "⇒",
  "arrow.l.double": "⇐",
  "arrow.l.r.double": "⇔",
  "arrow.t": "↑",
  "arrow.b": "↓",
  "arrow.t.b": "↕",
  "arrow.t.double": "⇑",
  "arrow.b.double": "⇓",
  "arrow.t.b.double": "⇕",
  "arrow.r.long": "⟶",
  "arrow.l.long": "⟵",
  "arrow.r.bar": "↦",
  "mapsto": "↦",

  "diff": "∂",
  "partial": "∂",
  "nabla": "∇",
  "integral": "∫",
  "integral.double": "∬",
  "integral.triple": "∭",
  "integral.cont": "∮",
  "sum": "∑",
  "product": "∏",
  "infinity": "∞",
  "aleph": "ℵ",

  "forall": "∀",
  "exists": "∃",
  "exists.not": "∄",
  "and": "∧",
  "or": "∨",
  "not": "¬",
  "top": "⊤",
  "bot": "⊥",
  "tack.r": "⊢",
  "models": "⊨",

  "therefore": "∴",
  "because": "∵",
  "angle": "∠",
  "degree": "°",
  "prime": "′",
  "planck.reduce": "ℏ",
  "ell": "ℓ",
  "wp": "℘",
  "Re": "ℜ",
  "Im": "ℑ",

  "NN": "ℕ",
  "ZZ": "ℤ",
  "QQ": "ℚ",
  "RR": "ℝ",
  "CC": "ℂ",
  "PP": "ℙ",
  "HH": "ℍ",
};

function symPath(token: string): string | undefined {
  if (token.startsWith("sym.")) {
    return token.slice(4);
  }
  if (token.startsWith("math.")) {
    return token.slice(5);
  }
  return undefined;
}

export function formatLabel(s: string) {
  s = s.trim();
  if (s.startsWith("$") && s.endsWith("$") && s.length >= 2) {
    s = s.slice(1, -1).trim();
  }

  s = s.replace(/(?:sym|math)\.[a-zA-Z][a-zA-Z0-9_.]*/g, match => {
    const path = symPath(match) ?? "";
    return symToUnicode[path] ?? match;
  });

  if (s.length > 21) {
    s = s.slice(0, 20) + "…";
  }
  return s;
}

export const SYM_PALETTE: { name: string; expr: string; glyph: string }[] = Object.entries(
  symToUnicode
).map(([k, glyph]) => ({
  name: k,
  expr:
    ["NN", "ZZ", "QQ", "RR", "CC", "PP", "HH"].includes(k)
      ? `math.${k}`
      : `sym.${k}`,
  glyph,
}));
