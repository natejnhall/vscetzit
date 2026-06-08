import { useMemo } from "preact/hooks";
import { EdgeData, NodeData } from "../lib/Data";
import { computeControlPoints } from "../lib/curve";
import Styles from "../lib/Styles";
import SceneCoords from "../lib/SceneCoords";

interface EdgeControlHandlesProps {
  data: EdgeData;
  sourceData: NodeData;
  targetData: NodeData;
  tikzStyles: Styles;
  sceneCoords: SceneCoords;
  onPointerDown?: (cp: 1 | 2) => void;
}

// The two draggable handle circles for a selected edge's bezier control
// points. We render these in their own top-most SVG layer (above
// `nodeLayer`) so that a handle sitting visually behind a node label still
// receives pointer events — previously the handles lived inside the Edge
// component down in `edgeLayer`, and any overlapping node label would
// intercept the click.
//
// The guide cosmetics (dashed radius circles + tangent lines) stay inside
// the Edge component: they have `pointerEvents: none` and so don't block
// anything regardless of which layer they're in.
const EdgeControlHandles = ({
  data,
  sourceData,
  targetData,
  tikzStyles,
  sceneCoords,
  onPointerDown,
}: EdgeControlHandlesProps) => {
  const computed = useMemo(
    () => computeControlPoints(tikzStyles, sourceData, targetData, data),
    [tikzStyles, sourceData, targetData, data]
  );
  const cp1Raw = computed[0][2];
  const cp2Raw = computed[0][3];
  const cp1 = sceneCoords.coordToScreen(cp1Raw);
  const cp2 = sceneCoords.coordToScreen(cp2Raw);

  const basicBendMode = data.basicBendMode;
  const controlColor1 = basicBendMode ? "blue" : "rgb(0,100,0)";
  const r = 0.1 * sceneCoords.scale;

  return (
    <g>
      <circle
        cx={cp1.x}
        cy={cp1.y}
        r={r}
        fill="rgba(255, 255, 255, 0.8)"
        stroke={controlColor1}
        stroke-width={2}
        onPointerDown={() => onPointerDown?.(1)}
      />
      <circle
        cx={cp2.x}
        cy={cp2.y}
        r={r}
        fill="rgba(255, 255, 255, 0.8)"
        stroke={controlColor1}
        stroke-width={2}
        onPointerDown={() => onPointerDown?.(2)}
      />
    </g>
  );
};

export default EdgeControlHandles;
