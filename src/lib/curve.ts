import { Coord, EdgeData, NodeData } from "./Data";
import Styles from "./Styles";
import { styleShape } from "./styleUtils";

function almostZero(f: number): boolean {
  return f >= -0.000001 && f <= 0.000001;
}

// function almostEqual(f1: number, f2: number): boolean {
//   return almostZero(f1 - f2);
// }

// return a new pair of coordinates along the same line, with the head and tail shortened by the given amounts
export function shortenLine(
  c1: Coord,
  c2: Coord,
  shortenHead: number,
  shortenTail: number
): [Coord, Coord] {
  const dx = c2.x - c1.x;
  const dy = c2.y - c1.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len === 0) {
    return [c1, c2];
  }
  const unitX = dx / len;
  const unitY = dy / len;
  return [
    c1.shift(unitX * shortenHead, unitY * shortenHead),
    c2.shift(-unitX * shortenTail, -unitY * shortenTail),
  ];
}

function linearInterpolate(dist: number, c0: number, c1: number): number {
  return (1 - dist) * c0 + dist * c1;
}

function cubicInterpolate(dist: number, c0: number, c1: number, c2: number, c3: number): number {
  const distp = 1 - dist;
  return (
    distp * distp * distp * c0 +
    3 * (distp * distp) * dist * c1 +
    3 * (dist * dist) * distp * c2 +
    dist * dist * dist * c3
  );
}

export function bezierInterpolate(
  dist: number,
  c1: Coord,
  c2: Coord,
  cp1: Coord,
  cp2: Coord
): Coord {
  return new Coord(
    cubicInterpolate(dist, c1.x, cp1.x, cp2.x, c2.x),
    cubicInterpolate(dist, c1.y, cp1.y, cp2.y, c2.y)
  );
}

export function tangent(
  [c1, c2, cp1, cp2]: [Coord, Coord, Coord | undefined, Coord | undefined],
  start: number,
  end: number
): Coord {
  let dx: number;
  let dy: number;

  if (cp1 !== undefined && cp2 !== undefined) {
    dx =
      cubicInterpolate(end, c1.x, cp1.x, cp2.x, c2.x) -
      cubicInterpolate(start, c1.x, cp1.x, cp2.x, c2.x);
    dy =
      cubicInterpolate(end, c1.y, cp1.y, cp2.y, c2.y) -
      cubicInterpolate(start, c1.y, cp1.y, cp2.y, c2.y);
  } else {
    dx = linearInterpolate(end, c1.x, c2.x) - linearInterpolate(start, c1.x, c2.x);
    dy = linearInterpolate(end, c1.y, c2.y) - linearInterpolate(start, c1.y, c2.y);
  }

  // normalise
  const len = Math.sqrt(dx * dx + dy * dy);
  if (!almostZero(len)) {
    const normalizedDx = (dx / len) * 0.1;
    const normalizedDy = (dy / len) * 0.1;
    return new Coord(normalizedDx, normalizedDy);
  }

  return new Coord(dx, dy);
}

// compute intersection of a ray exiting the origin at "angle" with a regular polygon
// defined by "startAngle" and "sides" with an inscribed radius of "r"
function polygonOffset(angle: number, startAngle: number, sides: number, r: number): Coord {
  // find the angle of the nearest vertices on either side of "angle"
  const angleStep = (2 * Math.PI) / sides;
  const segment = Math.floor((angle - startAngle) / angleStep);
  const a0 = startAngle + segment * angleStep;
  const a1 = a0 + angleStep;

  const outerR = 0.2 * (1 / Math.cos(Math.PI / sides));

  // compute vertices of the edge
  const v0x = outerR * Math.cos(a0);
  const v0y = outerR * Math.sin(a0);
  const v1x = outerR * Math.cos(a1);
  const v1y = outerR * Math.sin(a1);

  // compute intersection of the ray with the edge connecting v0 and v1
  // ray: (t * cos(angle), t * sin(angle)) for t >= 0
  // edge: v0 + s * (v1 - v0) for s in [0, 1]
  // solve: t * cos(angle) = v0x + s * (v1x - v0x)
  //        t * sin(angle) = v0y + s * (v1y - v0y)

  const rayDx = Math.cos(angle);
  const rayDy = Math.sin(angle);
  const edgeDx = v1x - v0x;
  const edgeDy = v1y - v0y;

  // solve the system of equations
  const denominator = rayDx * edgeDy - rayDy * edgeDx;
  const s = (rayDy * v0x - rayDx * v0y) / denominator;
  const t = (v0x + s * edgeDx) / rayDx;

  return new Coord(t * rayDx, t * rayDy);
}

export function computeControlPoints(
  tikzStyles: Styles,
  sourceData: NodeData,
  targetData: NodeData,
  edgeData: EdgeData
): [Coord[], number, boolean] {
  let c1 = sourceData.coord;
  let c2 = targetData.coord;
  const dx = c2.x - c1.x;
  const dy = c2.y - c1.y;

  // Control-point distance = looseness * |source→target| / 3, matching lib.typ.
  // For self-loops we ignore this weight and use loop-size directly.
  let weight: number;
  const looseness = edgeData.propertyFloat("looseness");
  weight = (looseness ?? 1.0) / 3;

  let cpDist: number;
  let bezier = false;
  let inAngle: number;
  let outAngle: number;

  if (edgeData.isSelfLoop) {
    // Self-loop: a teardrop above the node by default. Convention matches
    // lib.typ: loop-angle is the bisector, loop-spread the aperture (positive =
    // CW traversal, control points splay symmetrically around the bisector).
    const loopAngleDeg = edgeData.propertyFloat("loop-angle") ?? 90;
    const loopSpreadDeg = edgeData.propertyFloat("loop-spread") ?? 90;
    const loopSize = edgeData.propertyFloat("loop-size") ?? 1.0;
    const loopAngleRad = (loopAngleDeg * Math.PI) / 180;
    const halfSpread = (loopSpreadDeg * Math.PI) / 360;
    outAngle = loopAngleRad + halfSpread;
    inAngle = loopAngleRad - halfSpread;
    cpDist = loopSize;
    bezier = true;
  } else {
    const bend = edgeData.bend;
    if (bend !== 0) {
      // Cetzit convention: positive bend = CCW pivot of outAngle relative to
      // the source→target bearing. Mirrors lib.typ exactly.
      const bendRadians = (bend * Math.PI) / 180;
      const angle = Math.atan2(dy, dx);
      outAngle = angle + bendRadians;
      inAngle = Math.PI + angle - bendRadians;
      bezier = true;
    } else if (
      edgeData.propertyFloat("in-angle") !== undefined &&
      edgeData.propertyFloat("out-angle") !== undefined
    ) {
      inAngle = (edgeData.propertyFloat("in-angle")! * Math.PI) / 180;
      outAngle = (edgeData.propertyFloat("out-angle")! * Math.PI) / 180;
      bezier = true;
    } else {
      outAngle = Math.atan2(dy, dx);
      inAngle = Math.PI + outAngle;
    }
    cpDist = almostZero(dx) && almostZero(dy)
      ? weight
      : Math.sqrt(dx * dx + dy * dy) * weight;
  }

  const cp1 = c1.shift(cpDist * Math.cos(outAngle), cpDist * Math.sin(outAngle));
  const cp2 = c2.shift(cpDist * Math.cos(inAngle), cpDist * Math.sin(inAngle));

  if (!edgeData.isSelfLoop && (sourceData.property("style") ?? "none") !== "none") {
    const style = tikzStyles.style(sourceData.property("style"));
    if (styleShape(style) === "rectangle") {
      const offset = polygonOffset(outAngle, Math.PI / 4, 4, 0.2);
      c1 = c1.shift(offset.x, offset.y);
    } else {
      c1 = c1.shift(Math.cos(outAngle) * 0.2, Math.sin(outAngle) * 0.2);
    }
  }

  if (!edgeData.isSelfLoop && (targetData.property("style") ?? "none") !== "none") {
    const style = tikzStyles.style(targetData.property("style"));
    if (styleShape(style) === "rectangle") {
      const offset = polygonOffset(inAngle, Math.PI / 4, 4, 0.2);
      c2 = c2.shift(offset.x, offset.y);
    } else {
      c2 = c2.shift(Math.cos(inAngle) * 0.2, Math.sin(inAngle) * 0.2);
    }
  }

  return [[c1, c2, cp1, cp2], cpDist, bezier];
}
