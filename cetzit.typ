
#import "@preview/cetz:0.5.0"

//--------------------------
// Figure rendering helper
//--------------------------
//
// Emitted figure files bind a function `<basename>(scale)` that calls
// `cetzit-render(...)` to wrap the cetz canvas. The figure body itself is
// always laid out at 11pt body text; the user controls the rendered size
// from main.typ.
//
// The wrapper function's `scale` parameter would shadow Typst's built-in
// `scale` function inside the function body, so we save a module-level
// reference here that the helper can reach unambiguously.
#let _typst-scale = scale

// Wraps a body of cetz drawing commands in the canonical render pipeline:
//
//   1. Pin internal font size to 11pt so node geometry and stroke widths
//      stay consistent regardless of surrounding body text.
//   2. Scale the result by the requested factor.
//
// `scale` is overloaded:
//   • ratio  (e.g. `150%`)  — used directly as the visual scale factor.
//   • number (e.g. `1.5`)    — treated as a ratio (1.5 → 150%).
//   • length (e.g. `14pt`)   — interpreted as the target font size; the
//     figure is scaled by `scale / 11pt`, so `scale: 22pt` renders the
//     figure at twice its base size (since the internal layout is 11pt).
#let cetzit-render(body, scale: 1.0) = {
  set text(size: 11pt)
  let factor = if type(scale) == length {
    (scale / 11pt) * 100%
  } else if type(scale) == ratio {
    scale
  } else {
    scale * 100%
  }
  _typst-scale(factor, reflow: true, body)
}

//--------------------------
// Nodes
//--------------------------

// Sentinel for the built-in "empty node" type. Users referring to "no style"
// explicitly write style: none-style; bare node((0,0)) resolves to this too.
#let none-style = "__cetzit_none_style__"

#let default-style = (
  shape: none,
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
  unlabeled-style: none,   // by default, unlabeled inherits labeled
)

#let node(pos, style: (:), label: none, name: none) = {
  // Built-in empty-node case: pure anchor when unlabeled, floating
  // pill-bounded label when labeled. Cannot be redefined.
  if style == (:) or style == none-style {
    let body = if label == none {
      box()
    } else {
      // Invisible pill bounding box around the label so edges can
      // clip against a sensible shape later.
      let labeled = text(top-edge: "bounds", bottom-edge: "bounds", label)
      context {
        let m = measure(labeled)
        let w = m.width  + 2 * default-style.inner-sep * 1cm
        let h = m.height + 2 * default-style.inner-sep * 1cm
        rect(
          fill: none, stroke: none, radius: 100%,
          width: w, height: h,
          inset: 0pt,
          align(center + horizon, labeled),
        )
      }
    }
    cetz.draw.content(pos, body, name: name)
    return
  }

  let s = default-style + style
  if label == none and "unlabeled-style" in s and s.unlabeled-style != none {
    s = s + s.unlabeled-style
  }

  // All shape branches produce Typst *content* and are wrapped uniformly by
  // cetz.draw.content(pos, body) at the bottom. We use Typst's built-in
  // `polygon.regular` / `polygon` rather than `cetz.draw.polygon` because
  // the latter returns cetz drawables and can't be embedded as content.
  let body = if s.shape == "rectangle" or s.shape == "pill" {
    let r = if s.shape == "pill" { 100% } else { s.corner-radius * 1cm }
    let labeled = text(top-edge: "bounds", bottom-edge: "bounds", label)
    context {
      let m = if label == none { (width: 0pt, height: 0pt) } else { measure(labeled) }
      let w = calc.max(s.min-width * 1cm, m.width + 2 * s.inner-sep * 1cm)
      let h = calc.max(s.min-height * 1cm, m.height + 2 * s.inner-sep * 1cm)
      rect(
        fill: s.fill, stroke: s.stroke, radius: r,
        width: w, height: h,
        inset: 0pt,
        align(center + horizon, labeled),
      )
    }

  } else if s.shape == "circle" {
    if label == none {
      circle(fill: s.fill, stroke: s.stroke,
             width: s.size * 1cm, height: s.size * 1cm)
    } else {
      circle(fill: s.fill, stroke: s.stroke,
             width: s.size * 1cm, height: s.size * 1cm,
             align(center + horizon, label))
    }

  } else if s.shape == "polygon" {
    // Regular n-gon. A regular polygon is forced to be square, so we pick one
    // side length that satisfies all of:
    //   - `size` floor
    //   - `min-width` and `min-height` floors
    //   - label fits with `inner-sep` padding on each side
    let labeled = text(top-edge: "bounds", bottom-edge: "bounds", label)
    context {
      let m = if label == none { (width: 0pt, height: 0pt) } else { measure(labeled) }
      let side = calc.max(
        s.size * 1cm,
        s.min-width * 1cm,
        s.min-height * 1cm,
        m.width + 2 * s.inner-sep * 1cm,
        m.height + 2 * s.inner-sep * 1cm,
      )
      let shape = polygon.regular(
        size: side,
        vertices: s.sides,
        fill: s.fill,
        stroke: s.stroke,
      )
      if label == none {
        shape
      } else {
        box(
          width: side,
          height: side,
          place(center + horizon, shape)
            + place(center + horizon, labeled),
        )
      }
    }

  } else if s.shape == "path" {
    // Closed polyline through user-supplied vertices.
    //
    // Edges in cetz attach at the wrapper content's bounding-box centre.
    // For an arbitrary polygon the centroid generally differs from the
    // vertex-extent bbox centre, which would make edges hit the shape
    // off-centre. We force the centroid onto the wrapper's centre by:
    //   (1) translating user vertices so the centroid is at origin
    //   (2) scaling so the maximum centroid-relative extent equals side/2
    //   (3) wrapping in a fixed `side × side` box and `place`-ing the
    //       polygon with an explicit offset so its centroid lands at the
    //       box centre regardless of how lopsided the bbox is.
    if s.vertices == none or s.vertices.len() < 3 {
      panic("path shape requires vertices array with at least 3 points")
    }
    let labeled = text(top-edge: "bounds", bottom-edge: "bounds", label)
    context {
      let m = if label == none { (width: 0pt, height: 0pt) } else { measure(labeled) }
      let side = calc.max(
        s.size * 1cm,
        s.min-width * 1cm,
        s.min-height * 1cm,
        m.width + 2 * s.inner-sep * 1cm,
        m.height + 2 * s.inner-sep * 1cm,
      )

      // (1) Centroid in user-vertex space.
      let cx = s.vertices.fold(0.0, (acc, v) => acc + v.at(0)) / s.vertices.len()
      let cy = s.vertices.fold(0.0, (acc, v) => acc + v.at(1)) / s.vertices.len()

      // (2) Half-extent: the largest distance from the centroid in any
      // single axis. Scale so this maps to side/2.
      let halfExtents = s.vertices.map(v => calc.max(
        calc.abs(v.at(0) - cx),
        calc.abs(v.at(1) - cy),
      ))
      let halfMax = calc.max(..halfExtents)
      if halfMax == 0 {
        panic("path vertices are degenerate (zero extent)")
      }
      let scale = (side / 2) / halfMax

      // Centroid-centred, scaled vertices (in absolute lengths).
      let centred = s.vertices.map(v => (
        (v.at(0) - cx) * scale,
        (v.at(1) - cy) * scale,
      ))
      let min-x = calc.min(..centred.map(p => p.at(0)))
      let min-y = calc.min(..centred.map(p => p.at(1)))

      // Typst polygon vertices must be non-negative — shift to make the
      // minimum (0, 0). We compensate with the `place` offset below.
      let shifted = centred.map(v => (v.at(0) - min-x, v.at(1) - min-y))
      let shape = polygon(fill: s.fill, stroke: s.stroke, ..shifted)

      // (3) Position the polygon inside the box so the original centroid
      // (which was at origin in `centred` coords, then translated by
      // (-min-x, -min-y) into `shifted` coords) lands at (side/2, side/2).
      // place(top+left) puts shape's bbox top-left at (dx, dy); shape's
      // centroid is at (-min-x, -min-y) inside its own bbox. So we want
      //   dx + (-min-x) = side/2  →  dx = side/2 + min-x
      box(
        width: side,
        height: side,
        inset: 0pt,
        stroke: none,
        place(top + left, dx: side / 2 + min-x, dy: side / 2 + min-y, shape)
          + (if label != none { place(center + horizon, labeled) } else { [] }),
      )
    }

  } else {
    panic("Unknown node shape: " + repr(s.shape))
  }

  cetz.draw.content(pos, body, name: name)
}



//--------------------------
// Edges
//--------------------------
#let default-edge-style = (
  stroke: black + 1pt,
)

#let default-edge-shape = (
  // "line" | "bend" | "in-out"
  // Self-loops auto-detected when source == target; use loop-* below.
  curve: "line",
  bend: 0deg,
  out-angle: 0deg,
  in-angle: 180deg,
  looseness: 1.0,

  // Self-loop appearance.
  loop-angle: 90deg,
  loop-spread: 90deg,
  loop-size: 1.0,
)

#let edge(source, target, positions: (:), style: (:), shape: (:)) = {
  let sty = default-edge-style + style
  let shp = default-edge-shape + shape

  let sp = positions.at(source)
  let tp = positions.at(target)

  if source == target {
    let out-a = shp.loop-angle + shp.loop-spread / 2
    let in-a  = shp.loop-angle - shp.loop-spread / 2
    let c1 = (sp.at(0) + shp.loop-size * calc.cos(out-a),
              sp.at(1) + shp.loop-size * calc.sin(out-a))
    let c2 = (sp.at(0) + shp.loop-size * calc.cos(in-a),
              sp.at(1) + shp.loop-size * calc.sin(in-a))
    cetz.draw.bezier(sp, sp, c1, c2, stroke: sty.stroke)

  } else if shp.curve == "line" {
    cetz.draw.line(sp, tp, stroke: sty.stroke)

  } else if shp.curve == "bend" or shp.curve == "in-out" {
    let dx = tp.at(0) - sp.at(0)
    let dy = tp.at(1) - sp.at(1)
    let dist = calc.sqrt(dx * dx + dy * dy)

    let (lo, li) = if type(shp.looseness) == array {
      (shp.looseness.at(0), shp.looseness.at(1))
    } else { (shp.looseness, shp.looseness) }

    let (out-a, in-a) = if shp.curve == "bend" {
      (calc.atan2(dx, dy) + shp.bend, calc.atan2(-dx, -dy) - shp.bend)
    } else {
      (shp.out-angle, shp.in-angle)
    }

    let c1 = (sp.at(0) + lo * dist / 3 * calc.cos(out-a),
              sp.at(1) + lo * dist / 3 * calc.sin(out-a))
    let c2 = (tp.at(0) + li * dist / 3 * calc.cos(in-a),
              tp.at(1) + li * dist / 3 * calc.sin(in-a))

    cetz.draw.bezier(sp, tp, c1, c2, stroke: sty.stroke)

  } else {
    panic("Unknown edge curve mode: " + shp.curve)
  }
}

//--------------------------
// Diagrams
//--------------------------

#let diagram(nodes: (), edges: ()) = {
  let pos = (:)
  for n in nodes {
    pos = pos + ((n.name): n.pos)
  }

  // Layer 1: edges (drawn first, painted over)
  for e in edges {
    edge(
      e.source,
      e.target,
      positions: pos,
      style: e.at("style", default: (:)),
      shape: e.at("shape", default: (:)),
    )
  }

  // Layer 2: nodes (drawn second, occlude edge endpoints)
  for n in nodes {
    node(
      n.pos,
      style: n.at("style", default: (:)),
      label: n.at("label", default: none),
      name: n.name,
    )
  }
}
