import { useContext, useMemo } from "preact/hooks";
import { Coord, EdgeData, NodeData } from "../lib/Data";
import SceneCoords from "../lib/SceneCoords";
import { computeControlPoints, tangent } from "../lib/curve";
import Styles from "../lib/Styles";
import { colorFromTypst, styleHasDash } from "../lib/styleUtils";
import CetzitHostContext from "./CetzitHostContext";

interface EdgeProps {
  data: EdgeData;
  sourceData: NodeData;
  targetData: NodeData;
  tikzStyles: Styles;
  selected?: boolean;
  highlighted?: boolean;
  onPointerDown?: () => void;
  onMouseOver?: () => void;
  onMouseOut?: () => void;
  onControlPointPointerDown?: (cp: 1 | 2) => void;
  sceneCoords: SceneCoords;
}

const Edge = ({
  data,
  sourceData,
  targetData,
  tikzStyles,
  selected,
  highlighted,
  onPointerDown,
  onMouseOver,
  onMouseOut,
  onControlPointPointerDown,
  sceneCoords,
}: EdgeProps) => {
  const host = useContext(CetzitHostContext);
  const style = tikzStyles.style(data.property("style"));
  const computed = useMemo(
    () => computeControlPoints(tikzStyles, sourceData, targetData, data),
    [tikzStyles, sourceData, targetData, data]
  );
  let [c1, c2, cp1, cp2] = computed[0];
  let cpDist = computed[1];
  const bezier = computed[2];

  let dashArray: string | undefined = undefined;
  if (styleHasDash(style, "dashed")) {
    dashArray = `${0.1 * sceneCoords.scale} ${0.0333 * sceneCoords.scale}`;
  } else if (styleHasDash(style, "dotted")) {
    dashArray = `${0.05 * sceneCoords.scale} ${0.0143 * sceneCoords.scale}`;
  }

  // Cetzit MVP doesn't render arrowheads (edges are undirected). The
  // arrowhead computation and JSX blocks were dropped — they'll come back
  // when lib.typ gains mark-end/mark-start support.
  void tangent;

  const basicBendMode = data.basicBendMode;
  const controlColor1 = basicBendMode ? "blue" : "rgb(0,100,0)";
  const controlColor2 = basicBendMode ? "rgba(100,100,255,0.2)" : "rgba(0,150,0,0.2)";
  const strokeWidth = sceneCoords.scale * 0.035;
  const drawColor = colorFromTypst(style.property("stroke")) ?? "black";

  // map coords to screen
  const nodeCoord1 = sceneCoords.coordToScreen(sourceData.coord);
  const nodeCoord2 = sceneCoords.coordToScreen(targetData.coord);
  cpDist *= sceneCoords.scale;
  [c1, c2, cp1, cp2] = [c1, c2, cp1, cp2].map(p => sceneCoords.coordToScreen(p));
  // arrowTail/arrowHead are always undefined in v1; skip the remap.

  return (
    <g onMouseOver={onMouseOver} onMouseOut={onMouseOut}>
      <g onPointerDown={onPointerDown}>
        {bezier ? (
          <g>
            <path
              d={`M${c1.x},${c1.y} C${cp1.x},${cp1.y} ${cp2.x},${cp2.y} ${c2.x},${c2.y}`}
              stroke="rgb(150, 200, 255)"
              stroke-width={strokeWidth * 5}
              fill="none"
              style={{
                opacity: highlighted ? 0.4 : 0,
                transition: host.getConfig("enableAnimations") ? "opacity 0.2s ease-out" : "none",
              }}
            />
            <path
              d={`M${c1.x},${c1.y} C${cp1.x},${cp1.y} ${cp2.x},${cp2.y} ${c2.x},${c2.y}`}
              stroke={drawColor}
              stroke-width={strokeWidth}
              stroke-dasharray={dashArray}
              fill="none"
            />
          </g>
        ) : (
          <g>
            <line
              x1={c1.x}
              y1={c1.y}
              x2={c2.x}
              y2={c2.y}
              stroke="rgb(150, 200, 255)"
              stroke-width={strokeWidth * 5}
              style={{
                opacity: highlighted ? 0.4 : 0,
                transition: host.getConfig("enableAnimations") ? "opacity 0.2s ease-out" : "none",
              }}
            />
            <line
              x1={c1.x}
              y1={c1.y}
              x2={c2.x}
              y2={c2.y}
              stroke={drawColor}
              stroke-width={strokeWidth}
              stroke-dasharray={dashArray}
            />
          </g>
        )}
      </g>
      <g
        style={{
          pointerEvents: "none",
          opacity: selected ? 1 : 0,
          transition: host.getConfig("enableAnimations") ? "opacity 0.2s ease-out" : "none",
        }}
      >
        <circle
          cx={nodeCoord1.x}
          cy={nodeCoord1.y}
          r={cpDist}
          fill="none"
          stroke-width={2}
          style={{
            stroke: controlColor2,
            transition: host.getConfig("enableAnimations") ? "stroke 0.2s ease-out" : "none",
          }}
        />
        <line
          x1={nodeCoord1.x}
          y1={nodeCoord1.y}
          x2={cp1.x}
          y2={cp1.y}
          stroke-width={2}
          style={{
            stroke: controlColor1,
            transition: host.getConfig("enableAnimations") ? "stroke 0.2s ease-out" : "none",
          }}
        />
        <circle
          cx={nodeCoord2.x}
          cy={nodeCoord2.y}
          r={cpDist}
          fill="none"
          stroke-width={2}
          style={{
            stroke: controlColor2,
            transition: host.getConfig("enableAnimations") ? "stroke 0.2s ease-out" : "none",
          }}
        />
        <line
          x1={nodeCoord2.x}
          y1={nodeCoord2.y}
          x2={cp2.x}
          y2={cp2.y}
          stroke-width={2}
          style={{
            stroke: controlColor1,
            transition: host.getConfig("enableAnimations") ? "stroke 0.3s ease-out" : "none",
          }}
        />
      </g>
      {selected && (
        <g>
          <circle
            cx={cp1.x}
            cy={cp1.y}
            r={0.1 * sceneCoords.scale}
            fill="rgba(255, 255, 255, 0.8)"
            stroke={controlColor1}
            stroke-width={2}
            onPointerDown={() => onControlPointPointerDown?.(1)}
          />
          <circle
            cx={cp2.x}
            cy={cp2.y}
            r={0.1 * sceneCoords.scale}
            fill="rgba(255, 255, 255, 0.8)"
            stroke={controlColor1}
            stroke-width={2}
            onPointerDown={() => onControlPointPointerDown?.(2)}
          />
        </g>
      )}
    </g>
  );
};

export default Edge;
