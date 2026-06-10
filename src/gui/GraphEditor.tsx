import { useCallback, useContext, useEffect, useReducer, useRef, useState } from "preact/hooks";
import { TargetedMouseEvent, TargetedPointerEvent, TargetedWheelEvent } from "preact";

import Graph from "../lib/Graph";
import { drawGrid } from "../lib/grid";
import SceneCoords from "../lib/SceneCoords";
import Node from "./Node";
import Edge from "./Edge";
import EdgeControlHandles from "./EdgeControlHandles";
import Styles from "../lib/Styles";
import { Coord, EdgeData, NodeData, PathData } from "../lib/Data";
import { shortenLine } from "../lib/curve";
import { parseFigure } from "../lib/CetzitParser";
import Path from "./Path";
import CetzitHostContext from "./CetzitHostContext";

export type GraphTool = "select" | "vertex" | "edge";

interface GraphEditorProps {
  tool: GraphTool;
  onToolChanged: (tool: GraphTool) => void;
  enabled: boolean;
  graph: Graph;
  onGraphChange: (graph: Graph, commit: boolean) => void;
  selectedNodes: Set<number>;
  selectedEdges: Set<number>;
  onSelectionChanged: (selectedNodes: Set<number>, selectedEdges: Set<number>) => void;
  onViewTikz: () => void;
  tikzStyles: Styles;
  currentNodeStyle: string;
  currentEdgeStyle: string;
  toggleStylePanel: (show: boolean | undefined) => void;
}

interface UIState {
  smartTool?: boolean;
  // Which tool the user was in when the right-click smart-switch fired.
  // Drives pointer-up disambiguation: "select" + no-drag right-click on a
  // node opens the label editor instead of creating a self-loop.
  smartToolFrom?: "select" | "vertex";
  draggingNodes?: boolean;
  prevGraph?: Graph;
  mouseDownPos?: Coord;
  mouseMoved?: boolean;
  showSelectionRect?: boolean;
  selectionRect?: { x: number; y: number; width: number; height: number };
  edgeStartNode?: number;
  edgeEndNode?: number;
  addEdgeLineStart?: Coord;
  addEdgeLineEnd?: Coord;
  highlightPath?: number;
  // Spacebar + left-drag is the pan gesture. Pointer-down records the
  // viewport scroll position and the cursor's viewport-absolute
  // (clientX/clientY) position; pointer-move scrolls the viewport by the
  // viewport-coord delta. We *must* diff in viewport space, not the
  // SVG-relative `mousePositionToCoord` space — the SVG itself shifts in
  // viewport coords as we scroll, so a SVG-relative diff feeds our own
  // scroll back into the input and halves the apparent pan speed.
  panMode?: boolean;
  panStartScrollLeft?: number;
  panStartScrollTop?: number;
  panStartClientX?: number;
  panStartClientY?: number;
}

const uiStateReducer = (state: UIState, action: UIState | "reset"): UIState => {
  if (action === "reset") {
    return { selectionRect: state.selectionRect };
  } else {
    return { ...state, ...action };
  }
};

const GraphEditor = ({
  tool,
  onToolChanged: setTool,
  enabled,
  graph,
  onGraphChange: updateGraph,
  selectedNodes,
  selectedEdges,
  onSelectionChanged: updateSelection,
  onViewTikz: viewTikz,
  tikzStyles,
  currentNodeStyle,
  currentEdgeStyle,
  toggleStylePanel,
}: GraphEditorProps) => {
  const host = useContext(CetzitHostContext);
  const [sceneCoords, setSceneCoords] = useState<SceneCoords>(new SceneCoords());
  const [uiState, updateUIState] = useReducer(uiStateReducer, {});
  const numClicks = useRef<number>(0);

  // refs used to pass data from edge components to the graph editor
  const clickedEdge = useRef<number | undefined>(undefined);
  const clickedControlPoint = useRef<[number, 1 | 2] | undefined>(undefined);

  // Tracks whether the spacebar is currently held; pointer-down checks this
  // ref to decide whether the gesture should pan. We hold it in a ref (not
  // state) so neither key transition triggers a re-render.
  const spaceHeld = useRef<boolean>(false);

  // If a panel text input (e.g. the label field) had focus when the user
  // started a canvas gesture, we swallow the entire gesture: pointer-down
  // blurs the input and focuses the SVG, then both pointer-move and
  // pointer-up early-out so no tool action fires. This lets the user
  // "click away" from a label edit without also placing a vertex / starting
  // an edge / etc. Reset at the top of every pointer-down.
  const swallowGesture = useRef<boolean>(false);

  // path selection is calculated from selected edges or nodes
  const selectedPaths = new Set(
    selectedEdges.size > 0
      ? Array.from(selectedEdges).map(e => graph.edge(e)!.path)
      : graph.edges
          .filter(d => selectedNodes.has(d.source) && selectedNodes.has(d.target))
          .map(d => d.path)
  );

  useEffect(() => {
    // Grab focus initially and when the editor tab gains focus
    const editor = document.getElementById("graph-editor")!;
    editor.focus();
    const focusHandler = () => editor.focus();
    window.addEventListener("focus", focusHandler);

    // Center the viewport and preserve the current center point on resize
    const initCoords = new SceneCoords();
    const viewport = document.getElementById("graph-editor-viewport")!;
    let prevW = viewport.clientWidth;
    let prevH = viewport.clientHeight;
    viewport.scrollLeft = initCoords.originX - prevW / 2;
    viewport.scrollTop = initCoords.originY - prevH / 2;
    drawGrid(
      editor,
      initCoords,
      host.getConfig("axisColor"),
      host.getConfig("majorGridColor"),
      host.getConfig("minorGridColor")
    );

    const resizeObserver = new ResizeObserver(() => {
      const w = viewport.clientWidth;
      const h = viewport.clientHeight;
      const centerX = viewport.scrollLeft + prevW / 2;
      const centerY = viewport.scrollTop + prevH / 2;
      viewport.scrollLeft = centerX - w / 2;
      viewport.scrollTop = centerY - h / 2;
      prevW = w;
      prevH = h;
    });

    resizeObserver.observe(viewport);

    // Track spacebar for pan gesture. We listen at the window level so the
    // keydown fires regardless of which child element inside the graph
    // editor has focus, but gate on the canvas being the active region so
    // pressing space while typing in the style-panel label field still
    // inserts a literal space.
    const isCanvasActive = () => {
      const el = document.getElementById("graph-editor");
      if (!el) return false;
      return document.activeElement === el || el.contains(document.activeElement);
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Space" && isCanvasActive()) {
        e.preventDefault(); // avoid the webview scrolling on space
        spaceHeld.current = true;
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        spaceHeld.current = false;
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);

    return () => {
      window.removeEventListener("focus", focusHandler);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      resizeObserver.disconnect();
    };
  }, []);

  useEffect(() => {
    host.onCommand(command => handleCommand(command));
  });

  const mousePositionToCoord = (event: TargetedMouseEvent<SVGSVGElement>): Coord => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    return new Coord(x, y);
  };

  const updateSceneCoords = useCallback(
    (coords: SceneCoords, focalPoint: Coord | undefined = undefined) => {
      if (!sceneCoords.equals(coords)) {
        setSceneCoords(coords);
        const editor = document.getElementById("graph-editor")!;
        drawGrid(
          editor,
          coords,
          host.getConfig("axisColor"),
          host.getConfig("majorGridColor"),
          host.getConfig("minorGridColor")
        );

        const viewport = document.getElementById("graph-editor-viewport")!;
        const c0 =
          focalPoint ??
          new Coord(
            viewport.scrollLeft + viewport.clientWidth / 2,
            viewport.scrollTop + viewport.clientHeight / 2
          );
        const c1 = coords.coordToScreen(sceneCoords.coordFromScreen(c0));
        viewport.scrollLeft += c1.x - c0.x;
        viewport.scrollTop += c1.y - c0.y;
      }
    },
    [sceneCoords, setSceneCoords]
  );

  // ----- shared edge/CP helpers (used by both select-mode and edge-mode) -----

  // Selects (or extends the selection to) the given edge, honouring ctrl
  // (select whole path) and shift (add to selection) modifiers.
  const selectEdge = (edgeId: number, ctrl: boolean, shift: boolean) => {
    if (ctrl) {
      const path = graph.edge(edgeId)!.path;
      const pathNodes = new Set(graph.pathNodes(path));
      const pathEdges = new Set(graph.pathEdges(path));
      if (!selectedEdges.has(edgeId)) {
        updateSelection(selectedNodes.union(pathNodes), selectedEdges.union(pathEdges));
      } else {
        updateSelection(
          selectedNodes.difference(pathNodes),
          selectedEdges.difference(pathEdges)
        );
      }
    } else if (shift) {
      updateSelection(selectedNodes, selectedEdges.add(edgeId));
    } else {
      updateSelection(new Set(), new Set([edgeId]));
    }
  };

  // Applies a control-point drag at screen position `p`, updating the
  // dragged edge's bend / in-angle / out-angle / loop-* fields. Shared by
  // the select-mode and edge-mode pointer-move handlers.
  const dragControlPoint = (p: Coord) => {
    const [edge, pt] = clickedControlPoint.current!;
    let d = graph.edge(edge)!;
    const sourceCoord = sceneCoords.coordToScreen(graph.node(d.source)!.coord);
    const targetCoord = sceneCoords.coordToScreen(graph.node(d.target)!.coord);
    const dx1 = targetCoord.x - sourceCoord.x;
    const dy1 = targetCoord.y - sourceCoord.y;
    let dx2: number, dy2: number;
    if (pt === 1) {
      dx2 = p.x - sourceCoord.x;
      dy2 = p.y - sourceCoord.y;
    } else {
      dx2 = p.x - targetCoord.x;
      dy2 = p.y - targetCoord.y;
    }
    const baseDist = Math.sqrt(dx1 * dx1 + dy1 * dy1);
    const handleDist = Math.sqrt(dx2 * dx2 + dy2 * dy2);

    // Math-y-up angle from anchor toward dragged handle. Screen y is
    // flipped, so we negate dy.
    const controlAngle = (Math.atan2(-dy2, dx2) * 180) / Math.PI;

    if (d.isSelfLoop) {
      const oldLoopAngle = d.propertyFloat("loop-angle") ?? 90;
      const oldSpread = d.propertyFloat("loop-spread") ?? 90;
      const oldCp1 = oldLoopAngle + oldSpread / 2;
      const oldCp2 = oldLoopAngle - oldSpread / 2;

      const snappedCpAngle = Math.round(controlAngle / 15) * 15;
      let newLoopAngle: number;
      let newSpread: number;
      if (pt === 1) {
        newLoopAngle = (snappedCpAngle + oldCp2) / 2;
        newSpread = snappedCpAngle - oldCp2;
      } else {
        newLoopAngle = (oldCp1 + snappedCpAngle) / 2;
        newSpread = oldCp1 - snappedCpAngle;
      }
      while (newLoopAngle > 180) newLoopAngle -= 360;
      while (newLoopAngle <= -180) newLoopAngle += 360;
      const newSize = Math.max(0.1, Math.round((handleDist / sceneCoords.scale) * 10) / 10);

      d = d
        .setProperty("loop-angle", newLoopAngle)
        .setProperty("loop-spread", newSpread)
        .setProperty("loop-size", newSize);
    } else {
      let weight: number;
      if (baseDist !== 0) {
        weight = handleDist / baseDist;
      } else {
        weight = handleDist / sceneCoords.scale;
      }
      weight = Math.round(weight * 10) / 10;
      const looseness = Math.round(weight * 30) / 10;
      if (looseness === 1) {
        d = d.unset("looseness");
      } else {
        d = d.setProperty("looseness", looseness);
      }

      if (d.basicBendMode) {
        const baseAngle = (Math.atan2(-dy1, dx1) * 180) / Math.PI;
        let bend: number;
        if (pt === 1) {
          bend = controlAngle - baseAngle;
        } else {
          bend = baseAngle + 180 - controlAngle;
        }
        while (bend > 180) bend -= 360;
        while (bend <= -180) bend += 360;
        d = d.setBend(Math.round(bend / 15) * 15);
      } else {
        if (pt === 1) {
          d = d.setProperty("out-angle", Math.round(controlAngle / 15) * 15);
        } else {
          d = d.setProperty("in-angle", Math.round(controlAngle / 15) * 15);
        }
      }
    }

    updateGraph(graph.setEdgeData(edge, d), false);
  };

  // Toggles an edge between basic-bend mode and in/out-angle mode (the
  // double-click on edge / control-point gesture).
  const toggleEdgeBezierMode = (edgeId: number) => {
    let d = graph.edge(edgeId)!;
    const sCoord = graph.node(d.source)!.coord;
    const tCoord = graph.node(d.target)!.coord;
    const baseAngle = (Math.atan2(tCoord.y - sCoord.y, tCoord.x - sCoord.x) * 180) / Math.PI;

    if (d.basicBendMode) {
      // Enter in-out mode: derive absolute tangent angles from baseAngle ± bend.
      const bend = d.bend;
      const outAngle = Math.round((baseAngle + bend) / 15) * 15;
      const inAngle = Math.round((baseAngle + 180 - bend) / 15) * 15;
      d = d
        .unset("bend")
        .setProperty("curve", "in-out")
        .setProperty("out-angle", outAngle)
        .setProperty("in-angle", inAngle);
    } else {
      // Collapse in-out back to a single bend value.
      const outAngle = d.propertyFloat("out-angle") ?? 0;
      const bend = Math.round((outAngle - baseAngle) / 15) * 15;
      d = d
        .unset("in-angle")
        .unset("out-angle")
        .unset("curve")
        .setBend(bend);
      if (bend !== 0) {
        d = d.setProperty("curve", "bend");
      }
    }

    updateGraph(graph.setEdgeData(d.id, d), true);
  };

  const handlePointerDown = (event: TargetedPointerEvent<SVGSVGElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
    if (!enabled) {
      return;
    }

    // If a side-panel text input had focus (typically the label field
    // immediately after the user finished typing), treat this canvas
    // click purely as "commit and exit edit": blur the input, move
    // focus to the SVG, and swallow the gesture so no tool runs.
    // Without this, the same click both commits the label *and* fires
    // the active tool — placing a stray vertex in vertex mode, starting
    // an edge in edge mode, etc. — which is almost never intended.
    const active = document.activeElement;
    if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
      active.blur();
      event.currentTarget.focus();
      swallowGesture.current = true;
      return;
    }
    swallowGesture.current = false;

    // Focus the SVG element to enable keyboard events
    event.currentTarget.focus();

    const CTRL = window.navigator.platform.includes("Mac") ? "Meta" : "Control";
    const multiSelect = event.getModifierState(CTRL) || event.getModifierState("Shift");
    const p = mousePositionToCoord(event);
    const p1 = sceneCoords.coordFromScreen(p);
    const clickedNode = graph.nodes.find(
      d => Math.abs(d.coord.x - p1.x) < 0.22 && Math.abs(d.coord.y - p1.y) < 0.22
    )?.id;
    updateUIState({ mouseDownPos: p, draggingNodes: false });

    // Space + left-click is the pan gesture (shift was originally the
    // modifier, but shift+click is already overloaded by every tool for
    // multi-select / endpoint stickiness, so we use space instead — a
    // standard "hand tool" modifier in graphics apps). We capture the
    // viewport-absolute cursor position alongside the scroll offset so
    // pointer-move can compute the pan delta in viewport space. Diffing
    // in SVG-relative coords would be wrong: as we scroll, the SVG
    // itself shifts under the cursor, halving the apparent pan speed.
    if (event.button === 0 && spaceHeld.current) {
      const viewport = document.getElementById("graph-editor-viewport")!;
      updateUIState({
        panMode: true,
        panStartScrollLeft: viewport.scrollLeft,
        panStartScrollTop: viewport.scrollTop,
        panStartClientX: event.clientX,
        panStartClientY: event.clientY,
      });
    }

    let currentTool = tool;
    // Right-click smart-tool switches:
    //   • select + node  → edge   (drag → connect; no-drag → label editor)
    //   • select + empty → vertex (release places a node)
    //   • vertex + node  → edge   (drag → connect; no-drag → self-loop)
    //   • vertex + empty → no switch (right-click on empty in vertex mode
    //                                 falls through to the normal vertex
    //                                 pointer-up, same as left-click)
    if (event.button === 2) {
      if (tool === "select" && clickedNode !== undefined) {
        currentTool = "edge";
        updateUIState({ smartTool: true, smartToolFrom: "select" });
        setTool(currentTool);
      } else if (tool === "select" && clickedNode === undefined) {
        currentTool = "vertex";
        updateUIState({ smartTool: true, smartToolFrom: "select" });
        setTool(currentTool);
      } else if (tool === "vertex" && clickedNode !== undefined) {
        currentTool = "edge";
        updateUIState({ smartTool: true, smartToolFrom: "vertex" });
        setTool(currentTool);
      }
    }

    switch (currentTool) {
      case "select":
        if (clickedControlPoint.current !== undefined) {
          updateUIState({ prevGraph: graph });
        } else if (clickedNode !== undefined) {
          // select a node single node and/or prepare to drag nodes
          if (multiSelect) {
            if (selectedNodes.has(clickedNode)) {
              const sel = new Set(selectedNodes);
              sel.delete(clickedNode);
              updateSelection(sel, selectedEdges);
            } else {
              const sel = new Set(selectedNodes);
              sel.add(clickedNode);
              updateSelection(sel, selectedEdges);
            }
          } else {
            updateUIState({ prevGraph: graph, draggingNodes: true, mouseMoved: false });
            if (!selectedNodes.has(clickedNode)) {
              updateSelection(new Set([clickedNode]), new Set());
            }
          }
        } else if (clickedEdge.current !== undefined) {
          selectEdge(clickedEdge.current, event.getModifierState(CTRL), event.getModifierState("Shift"));
        } else {
          if (!multiSelect) {
            updateSelection(new Set(), new Set());
          }

          // Skip the rubber-band when space is held — space+drag is reserved
          // for panning, and we don't want both gestures running at once.
          if (!spaceHeld.current) {
            updateUIState({
              showSelectionRect: true,
              selectionRect: {
                x: p.x,
                y: p.y,
                width: 0,
                height: 0,
              },
            });
          }
        }

        break;
      case "vertex":
        // Click-on-an-existing-node in vertex mode is now a drag setup,
        // mirroring select mode's behaviour — pointer-up commits the
        // drag, or single-selects the node if there was no movement. A
        // click on empty space falls through unchanged; pointer-up will
        // place a new vertex there.
        if (clickedNode !== undefined) {
          updateUIState({ prevGraph: graph, draggingNodes: true, mouseMoved: false });
          if (!selectedNodes.has(clickedNode)) {
            updateSelection(new Set([clickedNode]), new Set());
          }
        }
        break;
      case "edge":
        // Edge mode mirrors select-mode behaviour when the user clicks on an
        // existing edge or a control point (rather than a node or empty
        // space): the edge becomes selected and its CPs become draggable,
        // and double-click toggles bezier mode (handled in pointer-up). A
        // click on a node (or empty) still starts a new edge as before.
        if (clickedControlPoint.current !== undefined) {
          updateUIState({ prevGraph: graph });
        } else if (clickedEdge.current !== undefined && clickedNode === undefined) {
          selectEdge(
            clickedEdge.current,
            event.getModifierState(CTRL),
            event.getModifierState("Shift")
          );
        } else {
          // Either starting a new edge drag from a vertex, OR an empty
          // click on the canvas. In both cases, drop any previously-
          // selected edge so the CP overlay goes away — the user has
          // moved on (either gesturing a new edge, or explicitly
          // clicking off the current selection). The earlier branches
          // already handled the cases where the click landed on the
          // selected edge or its CPs, so reaching this branch is a
          // definite signal that the CP interface should close.
          if (selectedEdges.size > 0) {
            updateSelection(selectedNodes, new Set());
          }
          updateUIState({ edgeStartNode: clickedNode, edgeEndNode: clickedNode });
        }
        break;
    }
  };

  const handlePointerMove = (event: TargetedPointerEvent<SVGSVGElement>) => {
    event.preventDefault();
    if (!enabled) {
      return;
    }

    // The gesture started with a panel input focused (see pointer-down);
    // ignore everything until the next pointer-down.
    if (swallowGesture.current) {
      return;
    }

    if (uiState.mouseDownPos === undefined || !enabled) {
      return;
    }
    const p = mousePositionToCoord(event);
    updateUIState({ mouseMoved: true });

    // Space-pan: scroll the viewport against the viewport-absolute cursor
    // delta and short-circuit the per-tool drag logic so nothing else fires
    // concurrently. We *cannot* use the SVG-relative `p` here — as we set
    // scrollLeft, the SVG itself shifts in viewport coords and a same
    // mouse position produces a different `p`. Diffing `p` against a fixed
    // `mouseDownPos` then under-counts the cursor motion (the next event's
    // p is partially "absorbed" by the SVG's own shift), producing a
    // half-speed jittery pan. clientX/clientY are viewport-absolute and
    // unaffected by scroll, so the delta is the true cursor motion.
    if (uiState.panMode) {
      const viewport = document.getElementById("graph-editor-viewport")!;
      viewport.scrollLeft =
        (uiState.panStartScrollLeft ?? 0) - (event.clientX - (uiState.panStartClientX ?? 0));
      viewport.scrollTop =
        (uiState.panStartScrollTop ?? 0) - (event.clientY - (uiState.panStartClientY ?? 0));
      return;
    }

    switch (tool) {
      case "select":
        if (uiState.showSelectionRect) {
          updateUIState({
            selectionRect: {
              x: Math.min(uiState.mouseDownPos.x, p.x),
              y: Math.min(uiState.mouseDownPos.y, p.y),
              width: Math.abs(uiState.mouseDownPos.x - p.x),
              height: Math.abs(uiState.mouseDownPos.y - p.y),
            },
          });
        } else if (uiState.draggingNodes && uiState.prevGraph !== undefined) {
          const c1 = sceneCoords.coordFromScreen(uiState.mouseDownPos);
          const c2 = sceneCoords.coordFromScreen(p);
          const dx = Math.round((c2.x - c1.x) * 4) / 4;
          const dy = Math.round((c2.y - c1.y) * 4) / 4;
          updateGraph(
            uiState.prevGraph.mapNodeData(d =>
              selectedNodes.has(d.id) ? d.setCoord(d.coord.shift(dx, dy)) : d
            ),
            false
          );
        } else if (clickedControlPoint.current !== undefined) {
          dragControlPoint(p);
        }
        break;
      case "vertex":
        // Vertex mode now supports drag-to-move: if pointer-down landed on
        // an existing node, translate the selected node(s) in real time.
        // Drag on empty space stays a no-op (the new-vertex placement
        // happens on pointer-up only when there was no movement).
        if (uiState.draggingNodes && uiState.prevGraph !== undefined) {
          const c1 = sceneCoords.coordFromScreen(uiState.mouseDownPos);
          const c2 = sceneCoords.coordFromScreen(p);
          const dx = Math.round((c2.x - c1.x) * 4) / 4;
          const dy = Math.round((c2.y - c1.y) * 4) / 4;
          updateGraph(
            uiState.prevGraph.mapNodeData(d =>
              selectedNodes.has(d.id) ? d.setCoord(d.coord.shift(dx, dy)) : d
            ),
            false
          );
        }
        break;
      case "edge":
        if (clickedControlPoint.current !== undefined) {
          // CP dragging works in edge mode too: clicking an edge to select
          // it (above) exposes its CPs, and dragging them tunes the curve
          // without leaving edge mode.
          dragControlPoint(p);
        } else if (uiState.edgeStartNode !== undefined) {
          const p1 = sceneCoords.coordFromScreen(p);
          const n = graph.nodes.find(
            d => Math.abs(d.coord.x - p1.x) < 0.22 && Math.abs(d.coord.y - p1.y) < 0.22
          )?.id;
          updateUIState({ edgeEndNode: n });
          let c1: Coord;
          let c2: Coord;
          if (n !== undefined) {
            [c1, c2] = shortenLine(
              graph.node(uiState.edgeStartNode)!.coord,
              graph.node(n)!.coord,
              0.2,
              0.2
            );
          } else {
            [c1, c2] = shortenLine(graph.node(uiState.edgeStartNode)!.coord, p1, 0.2, 0);
          }
          updateUIState({
            addEdgeLineStart: sceneCoords.coordToScreen(c1),
            addEdgeLineEnd: sceneCoords.coordToScreen(c2),
          });
        }
        break;
    }
  };

  const handlePointerUp = (event: TargetedPointerEvent<SVGSVGElement>) => {
    event.currentTarget.releasePointerCapture(event.pointerId);
    event.preventDefault();

    // Click-off-the-label gesture (see pointer-down): swallow the whole
    // event. Reset numClicks too — otherwise a real canvas click within
    // the next 400ms would be mis-counted as the second tap of a
    // double-click.
    if (swallowGesture.current) {
      swallowGesture.current = false;
      numClicks.current = 0;
      return;
    }

    // handle double-clicks/taps manually, since we're using the pointer
    // events API. 200ms window — tight enough that two intentionally
    // separate clicks don't get fused, but well above the ~60-100ms a
    // deliberate double-click takes on most pointing devices.
    numClicks.current += 1;
    setTimeout(() => {
      numClicks.current = 0;
    }, 200);

    if (!enabled) {
      return;
    }

    if (uiState.mouseDownPos === undefined || !enabled) {
      return;
    }
    const p = mousePositionToCoord(event);
    const p1 = sceneCoords.coordFromScreen(p);
    const clickedNode = graph.nodes.find(
      d => Math.abs(d.coord.x - p1.x) < 0.22 && Math.abs(d.coord.y - p1.y) < 0.22
    )?.id;

    // Space-pan release: skip the per-tool pointer-up logic entirely. The
    // scroll has already happened in pointer-move; we just clean up. A
    // space+click without movement (panMode set but mouseMoved false) is
    // intentionally let through so the tool's normal click behaviour
    // still runs — space is a transient modifier, not a mode switch.
    if (uiState.panMode && uiState.mouseMoved) {
      if (uiState.smartTool) {
        setTool("select");
      }
      clickedEdge.current = undefined;
      clickedControlPoint.current = undefined;
      updateUIState("reset");
      return;
    }

    switch (tool) {
      case "select":
        if (numClicks.current >= 2) {
          // double click
          if (clickedNode !== undefined) {
            toggleStylePanel(true);
            setTimeout(() => {
              const labelField = document.getElementById("label-field") as HTMLInputElement;
              labelField.focus();
              labelField.select();
            }, 10);
          } else if (
            clickedEdge.current !== undefined ||
            clickedControlPoint.current !== undefined
          ) {
            const edge = clickedEdge.current ?? clickedControlPoint.current![0];
            toggleEdgeBezierMode(edge);
          }
        } else if (uiState.showSelectionRect) {
          const sel = new Set(selectedNodes);
          for (const d of graph.nodes) {
            const c = sceneCoords.coordToScreen(d.coord);
            // if c is in selectionRect
            if (
              c.x > uiState.selectionRect!.x &&
              c.x < uiState.selectionRect!.x + uiState.selectionRect!.width &&
              c.y > uiState.selectionRect!.y &&
              c.y < uiState.selectionRect!.y + uiState.selectionRect!.height
            ) {
              sel.add(d.id);
            }
          }

          updateSelection(sel, selectedEdges);
        } else if (uiState.draggingNodes) {
          if (!uiState.mouseMoved) {
            // if multiple nodes are selected and I've clicked one of them without dragging, select only that node
            if (clickedNode !== undefined) {
              updateSelection(new Set([clickedNode]), new Set());
            }
          } else if (!uiState.prevGraph?.equals(graph)) {
            updateGraph(graph, true);
          }
        } else if (clickedControlPoint.current !== undefined) {
          if (!uiState.prevGraph?.equals(graph)) {
            updateGraph(graph, true);
          }
        }
        break;
      case "vertex": {
        // Double-click: the first click already placed (or selected) a
        // vertex on its own pointer-up. On the second click, focus the
        // label editor for that vertex instead of stacking a second
        // vertex on top.
        if (numClicks.current >= 2 && clickedNode !== undefined) {
          updateSelection(new Set([clickedNode]), new Set());
          toggleStylePanel(true);
          setTimeout(() => {
            const labelField = document.getElementById("label-field") as HTMLInputElement | null;
            labelField?.focus();
            labelField?.select();
          }, 10);
          break;
        }

        // Drag of an existing node — either commit the move or, if there
        // was no movement, just leave the node single-selected.
        if (uiState.draggingNodes) {
          if (!uiState.mouseMoved) {
            if (clickedNode !== undefined) {
              updateSelection(new Set([clickedNode]), new Set());
            }
          } else if (!uiState.prevGraph?.equals(graph)) {
            updateGraph(graph, true);
          }
          break;
        }

        // Drag on empty canvas (no node under cursor) is treated as a
        // user mistake — they probably meant edge mode. Do nothing on
        // release. Right-click drag from a node still creates an edge
        // via the smart-tool switch to the edge case, which fires
        // before this branch runs.
        if (uiState.mouseMoved) {
          break;
        }

        // Pick a user-visible name that doesn't collide with anything in the
        // current graph. We can't rely on the internal ID alone — the parser
        // reassigns internal IDs from 0 on every reload, so an emitted
        // fallback `n<id>` would clash with any existing name like "n8"
        // once enough nodes get added.
        const existingNames = new Set(
          graph.nodes.map(n => n.property("name") ?? `n${n.id}`)
        );
        let k = graph.numNodes;
        while (existingNames.has(`n${k}`)) k++;

        // Placing a new vertex clears the existing selection — otherwise a
        // stale highlight from a previous interaction would linger on
        // unrelated nodes. Cmd-Z restores the selection (and removes the
        // new vertex) via the snapshot wired in FigureEditor's
        // handleGraphChange.
        if (selectedNodes.size > 0 || selectedEdges.size > 0) {
          updateSelection(new Set(), new Set());
        }

        const node = new NodeData()
          .setId(graph.freshNodeId)
          .setCoord(p1.snapToGrid(4))
          .setProperty("style", currentNodeStyle)
          .setProperty("name", `n${k}`);
        updateGraph(graph.addNodeWithData(node), true);
        break;
      }
      case "edge":
        // Edge-mode double-click on an edge or control-point toggles bezier
        // mode, mirroring select-mode behaviour.
        if (
          numClicks.current >= 2 &&
          (clickedEdge.current !== undefined || clickedControlPoint.current !== undefined)
        ) {
          const edge = clickedEdge.current ?? clickedControlPoint.current![0];
          toggleEdgeBezierMode(edge);
          break;
        }

        // Edge-mode control-point drag release: commit if the drag actually
        // changed the graph.
        if (clickedControlPoint.current !== undefined) {
          if (!uiState.prevGraph?.equals(graph)) {
            updateGraph(graph, true);
          }
          break;
        }

        if (uiState.edgeStartNode !== undefined && uiState.edgeEndNode !== undefined) {
          // Right-click on a node in select mode with no drag → open the
          // label editor instead of creating a self-loop. Self-loops in
          // select mode are still reachable via drag (start==end is only
          // possible without drag when start was set on the same node).
          const sameNode = uiState.edgeStartNode === uiState.edgeEndNode;
          if (
            uiState.smartToolFrom === "select" &&
            sameNode &&
            !uiState.mouseMoved
          ) {
            const node = uiState.edgeStartNode;
            if (!selectedNodes.has(node)) {
              updateSelection(new Set([node]), new Set());
            }
            toggleStylePanel(true);
            setTimeout(() => {
              const labelField = document.getElementById("label-field") as HTMLInputElement | null;
              labelField?.focus();
              labelField?.select();
            }, 10);
            break;
          }

          const pathId = graph.freshPathId;
          let edge = new EdgeData()
            .setId(graph.freshEdgeId)
            .setSource(uiState.edgeStartNode)
            .setTarget(uiState.edgeEndNode)
            .setPath(pathId);
          if (currentEdgeStyle !== "none") {
            edge = edge.setProperty("style", currentEdgeStyle);
          }
          if (graph.node(edge.source)?.property("style") === "none") {
            edge = edge.setSourceAnchor("center");
          }
          if (graph.node(edge.target)?.property("style") === "none") {
            edge = edge.setTargetAnchor("center");
          }
          const path = new PathData().setId(pathId).setEdges([edge.id]);
          updateGraph(graph.addEdgeWithData(edge).addPathWithData(path), true);
        }
        break;
    }

    if (uiState.smartTool) {
      setTool("select");
    }

    clickedEdge.current = undefined;
    clickedControlPoint.current = undefined;
    updateUIState("reset");
  };

  const handleCommand = async (command: string) => {
    let capture = true;

    // check if the graph editor has keyboard focus
    const editor = document.getElementById("graph-editor");
    if (document.activeElement !== editor) {
      return;
    }

    // // if an input field is focused, ignore commands
    // const activeElement = document.activeElement;
    // if (activeElement instanceof HTMLInputElement || activeElement instanceof HTMLTextAreaElement) {
    //   return;
    // }

    const moveSelectedNodes = (dx: number, dy: number) => {
      if (selectedNodes.size !== 0) {
        const g = graph.mapNodeData(d =>
          selectedNodes.has(d.id) ? d.setCoord(d.coord.shift(dx, dy, 40)) : d
        );
        updateGraph(g, true);
      }
    };

    switch (command) {
      case "cetzit.gui.cut": {
        if (selectedNodes.size !== 0) {
          window.navigator.clipboard.writeText(graph.subgraphFromNodes(selectedNodes).tikz());
          const g = graph.removeNodes(selectedNodes);
          updateGraph(g, true);
          updateSelection(new Set(), new Set());
        }
        break;
      }
      case "cetzit.gui.copy": {
        if (selectedNodes.size !== 0) {
          window.navigator.clipboard.writeText(graph.subgraphFromNodes(selectedNodes).tikz());
        }
        break;
      }
      case "cetzit.gui.paste": {
        const pastedData = await window.navigator.clipboard.readText();
        const parsed = parseFigure(pastedData);
        if (parsed.result !== undefined) {
          // Regenerate each pasted node's user-visible `name` so it doesn't
          // collide with anything in the destination graph (including names
          // generated by an earlier paste in the same session). Labels stay
          // intact — copying a labeled node and pasting should preserve the
          // text the user typed.
          const existingNames = new Set(
            graph.nodes.map(n => n.property("name") ?? `n${n.id}`)
          );
          let k = graph.numNodes;
          const nextName = (): string => {
            while (existingNames.has(`n${k}`)) k++;
            const name = `n${k}`;
            existingNames.add(name);
            return name;
          };
          let g = parsed.result.mapNodeData(d => d.setProperty("name", nextName()));

          const nodes = g.nodeIds;
          if (nodes.length !== 0) {
            const n = nodes[0];
            while (graph.nodes.find(d => g.node(n)!.coord.equals(d.coord))) {
              g = g.shiftGraph(0.5, -0.5);
            }
          }

          const g1 = graph.insertGraph(g);
          const sel = new Set(g1.nodeIds);
          for (const n of graph.nodeIds) {
            sel.delete(n);
          }
          updateGraph(g1, true);
          updateSelection(sel, new Set());
        }
        break;
      }
      case "cetzit.gui.delete": {
        const g = graph.removeNodes(selectedNodes).removeEdges(selectedEdges);
        updateGraph(g, true);
        updateSelection(new Set(), new Set());
        break;
      }
      case "cetzit.gui.moveLeft": {
        moveSelectedNodes(-0.25, 0);
        break;
      }
      case "cetzit.gui.moveRight": {
        moveSelectedNodes(0.25, 0);
        break;
      }
      case "cetzit.gui.moveUp": {
        moveSelectedNodes(0, 0.25);
        break;
      }
      case "cetzit.gui.moveDown": {
        moveSelectedNodes(0, -0.25);
        break;
      }
      case "cetzit.gui.nudgeLeft": {
        moveSelectedNodes(-0.025, 0);
        break;
      }
      case "cetzit.gui.nudgeRight": {
        moveSelectedNodes(0.025, 0);
        break;
      }
      case "cetzit.gui.nudgeUp": {
        moveSelectedNodes(0, 0.025);
        break;
      }
      case "cetzit.gui.nudgeDown": {
        moveSelectedNodes(0, -0.025);
        break;
      }
      case "cetzit.gui.joinPaths": {
        if (selectedPaths.size > 1) {
          const g = graph.joinPaths(selectedPaths);
          if (!g.equals(graph)) {
            updateGraph(g, true);
          }
        }
        break;
      }
      case "cetzit.gui.splitPaths": {
        let g = graph;
        for (const p of selectedPaths) {
          g = g.splitPath(p);
        }

        if (!g.equals(graph)) {
          updateGraph(g, true);
        }
        break;
      }
      case "cetzit.gui.mergeNodes": {
        if (selectedNodes.size > 0) {
          const g = graph.mergeNodes(selectedNodes);
          if (!g.equals(graph)) {
            updateGraph(g, true);
          }
        }
        break;
      }
      case "cetzit.gui.reflectNodesHorizontally": {
        updateGraph(graph.reflectNodes(selectedNodes, true), true);
        break;
      }
      case "cetzit.gui.reflectNodesVertically": {
        updateGraph(graph.reflectNodes(selectedNodes, false), true);
        break;
      }
      case "cetzit.gui.reverseEdges": {
        updateGraph(graph.reverseEdges(selectedEdges), true);
        break;
      }
      case "cetzit.gui.bringToFront": {
        const g = graph.reorderElements(selectedNodes, selectedPaths, "front");
        updateGraph(g, true);
        break;
      }
      case "cetzit.gui.sendToBack": {
        const g = graph.reorderElements(selectedNodes, selectedPaths, "back");
        updateGraph(g, true);
        break;
      }
      case "cetzit.gui.bringForward": {
        const g = graph.reorderElements(selectedNodes, selectedPaths, "forward");
        updateGraph(g, true);
        break;
      }
      case "cetzit.gui.sendBackward": {
        const g = graph.reorderElements(selectedNodes, selectedPaths, "backward");
        updateGraph(g, true);
        break;
      }
      case "cetzit.gui.selectAll": {
        updateSelection(new Set(graph.nodeIds), new Set());
        break;
      }
      case "cetzit.gui.deselectAll": {
        updateSelection(new Set(), new Set());
        break;
      }
      case "cetzit.gui.extendSelectionLeft": {
        if (selectedNodes.size !== 0) {
          const maxX = Array.from(selectedNodes)
            .map(n => graph.node(n)?.coord.x ?? 0)
            .reduce((a, b) => (a > b ? a : b));
          updateSelection(
            new Set(graph.nodes.filter(n => n.coord.x <= maxX).map(n => n.id)),
            selectedEdges
          );
        }
        break;
      }
      case "cetzit.gui.extendSelectionRight": {
        if (selectedNodes.size !== 0) {
          const minX = Array.from(selectedNodes)
            .map(n => graph.node(n)?.coord.x ?? 0)
            .reduce((a, b) => (a < b ? a : b));
          updateSelection(
            new Set(graph.nodes.filter(n => n.coord.x >= minX).map(n => n.id)),
            selectedEdges
          );
        }
        break;
      }
      case "cetzit.gui.extendSelectionUp": {
        if (selectedNodes.size !== 0) {
          const minY = Array.from(selectedNodes)
            .map(n => graph.node(n)?.coord.y ?? 0)
            .reduce((a, b) => (a < b ? a : b));
          updateSelection(
            new Set(graph.nodes.filter(n => n.coord.y >= minY).map(n => n.id)),
            selectedEdges
          );
        }
        break;
      }
      case "cetzit.gui.extendSelectionDown": {
        if (selectedNodes.size !== 0) {
          const maxY = Array.from(selectedNodes)
            .map(n => graph.node(n)?.coord.y ?? 0)
            .reduce((a, b) => (a > b ? a : b));
          updateSelection(
            new Set(graph.nodes.filter(n => n.coord.y <= maxY).map(n => n.id)),
            selectedEdges
          );
        }
        break;
      }
      case "cetzit.gui.selectTool": {
        setTool("select");
        // Explicit mode change is a context reset — drop any current
        // node / edge selection so leftover state from the prior mode
        // doesn't bleed into the new one. Smart-tool switches (right-
        // click gestures in handlePointerDown) bypass this code path,
        // so transient mode flips during a gesture preserve selection.
        if (selectedNodes.size > 0 || selectedEdges.size > 0) {
          updateSelection(new Set(), new Set());
        }
        break;
      }
      case "cetzit.gui.nodeTool": {
        setTool("vertex");
        if (selectedNodes.size > 0 || selectedEdges.size > 0) {
          updateSelection(new Set(), new Set());
        }
        break;
      }
      case "cetzit.gui.edgeTool": {
        setTool("edge");
        if (selectedNodes.size > 0 || selectedEdges.size > 0) {
          updateSelection(new Set(), new Set());
        }
        break;
      }
      case "cetzit.gui.viewTikzSource": {
        viewTikz();
        break;
      }
      case "cetzit.gui.toggleStylePanel": {
        toggleStylePanel(undefined);
        break;
      }
      case "cetzit.gui.zoomIn": {
        const coords = sceneCoords.zoomIn();
        if (coords.scale <= 1024) {
          updateSceneCoords(coords);
        }
        break;
      }
      case "cetzit.gui.zoomOut": {
        const coords = sceneCoords.zoomOut();
        const viewport = document.getElementById("graph-editor-viewport")!;
        if (
          coords.screenWidth >= viewport.clientWidth &&
          coords.screenHeight >= viewport.clientHeight
        ) {
          updateSceneCoords(coords);
        }
        break;
      }
      case "cetzit.gui.centerViewport": {
        const viewport = document.getElementById("graph-editor-viewport")!;
        viewport.scrollLeft = sceneCoords.originX - viewport.clientWidth / 2;
        viewport.scrollTop = sceneCoords.originY - viewport.clientHeight / 2;
        break;
      }
      default: {
        capture = false;
        break;
      }
    }
    return capture;
  };

  const handleKeyDown = async (event: KeyboardEvent) => {
    if (!enabled) {
      return;
    }

    // ignore key events if focus is in an input field
    if (event.target instanceof HTMLElement && event.target.tagName === "INPUT") {
      return;
    }

    // handle Ctrl+A / Cmd+A for select all, in order to prevent text selection
    if (event.getModifierState(window.navigator.platform.includes("Mac") ? "Meta" : "Control")) {
      if (event.key === "a") {
        handleCommand("cetzit.gui.selectAll");
        event.preventDefault();
        event.stopPropagation();
        return;
      }
    }
  };

  const handleScrollWheel = (event: TargetedWheelEvent<SVGSVGElement>) => {
    const CTRL = window.navigator.platform.includes("Mac") ? "Meta" : "Control";
    if (event.getModifierState(CTRL)) {
      event.preventDefault();
      let delta = event.deltaY * -0.01;
      if (delta > 1) {
        delta = 1;
      } else if (delta < -1) {
        delta = -1;
      }
      const coords = sceneCoords.setZoom(sceneCoords.zoom + delta);
      const viewport = document.getElementById("graph-editor-viewport")!;
      if (
        coords.screenWidth >= viewport.clientWidth &&
        coords.screenHeight >= viewport.clientHeight
      ) {
        updateSceneCoords(coords, mousePositionToCoord(event));
      }
    }
  };

  return (
    <div
      id="graph-editor-viewport"
      class="frame"
      style={{
        height: "calc(100% - 50px)",
        maxHeight: "calc(100% - 50px)",
        overflowX: "scroll",
        overflowY: "scroll",
      }}
    >
      <svg
        id="graph-editor"
        style={{
          height: `${sceneCoords.screenHeight}px`,
          width: `${sceneCoords.screenWidth}px`,
          backgroundColor: enabled ? "white" : "#eeeeee",
          outline: "none",
        }}
        tabindex={0}
        onKeyDown={handleKeyDown}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onWheel={handleScrollWheel}
        onContextMenu={event => {
          // Prevent context menu when using smart tool with right-click
          event.preventDefault();
        }}
      >
        <g id="grid"></g>
        <g id="edgeLayer">
          {graph.paths.map(pathData => (
            <g key={pathData.id}>
              <Path
                data={pathData}
                graph={graph}
                tikzStyles={tikzStyles}
                sceneCoords={sceneCoords}
              />
              {pathData.edges.map(e => {
                const data = graph.edge(e)!;
                return (
                  <Edge
                    key={data.id}
                    data={data}
                    sourceData={graph.node(data.source)!}
                    targetData={graph.node(data.target)!}
                    tikzStyles={tikzStyles}
                    selected={selectedEdges.has(data.id)}
                    highlighted={
                      uiState.highlightPath === data.path || selectedPaths.has(data.path)
                    }
                    onPointerDown={() => (clickedEdge.current = data.id)}
                    onMouseOver={() => updateUIState({ highlightPath: data.path })}
                    onMouseOut={() => {
                      if (uiState.highlightPath === data.path) {
                        updateUIState({ highlightPath: undefined });
                      }
                    }}
                    sceneCoords={sceneCoords}
                  />
                );
              })}
            </g>
          ))}
        </g>
        <g id="nodeLayer">
          {/*
            Render unselected nodes first, selected ones after — SVG z-order
            is render order, so selected nodes end up visually on top and
            also win pointer events against any unselected node beneath
            them. Without this, a freshly pasted (and auto-selected) node
            sitting on top of an existing node would still pass clicks
            through to the underlying node because `graph.nodes` order
            isn't selection-aware.
          */}
          {graph.nodes
            .filter(data => !selectedNodes.has(data.id))
            .map(data => (
              <Node
                key={data.id}
                data={data}
                tikzStyles={tikzStyles}
                selected={false}
                highlight={uiState.edgeStartNode === data.id || uiState.edgeEndNode === data.id}
                sceneCoords={sceneCoords}
              />
            ))}
          {graph.nodes
            .filter(data => selectedNodes.has(data.id))
            .map(data => (
              <Node
                key={data.id}
                data={data}
                tikzStyles={tikzStyles}
                selected={true}
                highlight={uiState.edgeStartNode === data.id || uiState.edgeEndNode === data.id}
                sceneCoords={sceneCoords}
              />
            ))}
        </g>
        {/*
          Top-most layer for the bezier control-point handles of selected
          edges. Rendered AFTER nodeLayer so that a handle sitting visually
          behind a node label still receives pointer events — node labels
          would otherwise intercept clicks meant for the handle.
        */}
        <g id="controlPointLayer">
          {graph.edges
            .filter(data => selectedEdges.has(data.id))
            .map(data => (
              <EdgeControlHandles
                key={data.id}
                data={data}
                sourceData={graph.node(data.source)!}
                targetData={graph.node(data.target)!}
                tikzStyles={tikzStyles}
                sceneCoords={sceneCoords}
                onPointerDown={i => (clickedControlPoint.current = [data.id, i])}
              />
            ))}
        </g>
        <g id="selectionLayer">
          <rect
            x={uiState.selectionRect?.x ?? 0}
            y={uiState.selectionRect?.y ?? 0}
            width={uiState.selectionRect?.width ?? 0}
            height={uiState.selectionRect?.height ?? 0}
            fill="rgba(150, 150, 200, 0.2)"
            stroke="rgba(150, 150, 200, 1)"
            stroke-dasharray="5,2"
            style={{
              opacity: uiState.showSelectionRect ? 1 : 0,
              pointerEvents: "none",
              transition: host.getConfig("enableAnimations") ? "opacity 0.3s ease-out" : "none",
            }}
          />
        </g>
        <g id="control-layer">
          {uiState.addEdgeLineStart !== undefined && uiState.addEdgeLineEnd !== undefined && (
            <line
              x1={uiState.addEdgeLineStart.x}
              y1={uiState.addEdgeLineStart.y}
              x2={uiState.addEdgeLineEnd.x}
              y2={uiState.addEdgeLineEnd.y}
              stroke="rgb(100, 0, 200)"
              stroke-width={4}
            />
          )}
        </g>
      </svg>
    </div>
  );
};

export default GraphEditor;
