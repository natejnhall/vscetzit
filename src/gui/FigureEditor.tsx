import { useState, useEffect, useContext, useRef } from "preact/hooks";

import GraphEditor from "./GraphEditor";
import { GraphTool } from "./GraphEditor";
import Graph from "../lib/Graph";
import {
  isValidDelimString,
  ParseError,
  parseFigure,
  parseStylesFile,
} from "../lib/CetzitParser";
import StylePanel from "./StylePanel";
import Styles from "../lib/Styles";
import Toolbar from "./Toolbar";
import Splitpane from "./Splitpane";
import CetzitHostContext from "./CetzitHostContext";

interface FigureEditorContent {
  config: { [key: string]: any };
  document: string;
  styleFile: string;
  styles: string;
  // Sanitised file basename used as the emitter's `#let <name>(scale, align)`
  // identifier. Optional for backwards-compat — falls back to a generic name.
  documentName?: string;
}

interface FigureEditorProps {
  initialContent: FigureEditorContent;
}

const FigureEditor = ({ initialContent }: FigureEditorProps) => {
  const host = useContext(CetzitHostContext);
  const parsed = parseFigure(initialContent.document);
  const [graph, setGraph] = useState<Graph>(parsed.result ?? new Graph());
  const [enabled, setEnabled] = useState<boolean>(parsed.result !== undefined);
  const [parseErrors, setParseErrors] = useState<ParseError[]>(parsed.errors);
  const [tool, setTool] = useState<GraphTool>("select");
  const [currentNodeLabel, setCurrentNodeLabel] = useState<string | undefined>(undefined);
  const [currentNodeStyle, setCurrentNodeStyle] = useState<string>("none");
  const [currentEdgeStyle, setCurrentEdgeStyle] = useState<string>("none");
  const [selectedNodes, setSelectedNodes] = useState<Set<number>>(new Set());
  const [selectedEdges, setSelectedEdges] = useState<Set<number>>(new Set());
  const [showSecondPanel, setShowSecondPanel] = useState<boolean>(true);

  // Selection-restoration history for VS Code's text-edit undo/redo. Each
  // entry pairs a content string (the figure text the user would rewind
  // TO) with the selection that was active at that moment — so when
  // cmd-Z reverts the text and tryParseGraph fires with the matching
  // content, we restore the selection. Capped so it can't grow without
  // bound during long editing sessions.
  type SelectionSnapshot = {
    content: string;
    selectedNodes: Set<number>;
    selectedEdges: Set<number>;
  };
  const selectionHistory = useRef<SelectionSnapshot[]>([]);
  const MAX_SELECTION_HISTORY = 50;

  const parsedStyles = parseStylesFile(initialContent.styles);
  const [tikzStyles, setTikzStyles] = useState<Styles>(
    (parsedStyles.result ?? new Styles()).setFilename(initialContent.styleFile)
  );
  const [tikzStylesError, setTikzStylesError] = useState<boolean>(
    parsedStyles.result === undefined
  );

  // path selection is calculated from selected edges or nodes
  const selectedPaths = new Set(
    selectedEdges.size > 0
      ? Array.from(selectedEdges).map(e => graph.edge(e)!.path)
      : graph.edges
          .filter(d => selectedNodes.has(d.source) && selectedNodes.has(d.target))
          .map(d => d.path)
  );

  useEffect(() => {
    host.onUpdateToGui(source => {
      tryParseGraph(source);
    });

    host.onTikzStylesUpdated((filename, source) => {
      const parsed = parseStylesFile(source);
      if (parsed.result !== undefined) {
        const s = parsed.result.setFilename(filename);
        setTikzStyles(s);
        setTikzStylesError(false);
      } else {
        setTikzStylesError(true);
      }
    });
  });

  useEffect(() => {
    host.setErrors(parseErrors);
  }, [parseErrors]);

  const updateFromGui = (tikz: string) => {
    if (enabled) {
      host.updateFromGui(tikz);
    }
  };

  const refreshTikzStyles = (e: Event) => {
    if (e) {
      e.preventDefault();
    }
    host.refreshTikzStyles();
  };

  const openTikzStyles = (e: Event) => {
    if (e) {
      e.preventDefault();
    }
    host.openTikzStyles();
  };

  const toggleStylePanel = (show: boolean | undefined = undefined) => {
    if (show !== undefined) {
      setShowSecondPanel(show);
    } else {
      setShowSecondPanel(!showSecondPanel);
    }
  };

  const tryParseGraph = (tikz: string) => {
    const parsed = parseFigure(tikz);
    setParseErrors(parsed.errors);
    if (parsed.result !== undefined) {
      const g = parsed.result;
      g.inheritDataFrom(graph);
      setEnabled(true);
      setGraph(g);

      // If this content matches a snapshot in `selectionHistory`, the
      // user just hit cmd-Z (or cmd-shift-Z) and we're rewinding to a
      // prior state — restore the selection that was active at that
      // state. Filtering against `g.hasNode`/`hasEdge` covers the edge
      // case of a hand-edit that removed a node which was in the
      // snapshot. We don't slice the history on match: keeping
      // future-side entries lets cmd-Y reuse the same machinery.
      const snap = selectionHistory.current.find(s => s.content === tikz);
      if (snap) {
        const restoredNodes = new Set(
          Array.from(snap.selectedNodes).filter(id => g.hasNode(id))
        );
        const restoredEdges = new Set(
          Array.from(snap.selectedEdges).filter(id => g.hasEdge(id))
        );
        setSelectedNodes(restoredNodes);
        setSelectedEdges(restoredEdges);
        if (restoredNodes.size === 1) {
          const [n] = restoredNodes;
          setCurrentNodeLabel(g.node(n)?.label);
        } else {
          setCurrentNodeLabel(undefined);
        }
        return;
      }

      // update selection to remove any nodes/edges that no longer exist. n.b. we don't use handleSelectionChanged
      // as "setGraph" is async and hasn't updated the graph yet
      const newSelectedNodes = new Set(Array.from(selectedNodes).filter(id => g.hasNode(id)));
      setSelectedNodes(newSelectedNodes);
      setSelectedEdges(sel => new Set(Array.from(sel).filter(id => g.hasEdge(id))));
      if (newSelectedNodes.size === 1) {
        const [n] = newSelectedNodes;
        setCurrentNodeLabel(g.node(n)?.label);
      } else {
        setCurrentNodeLabel(undefined);
      }
    } else {
      setEnabled(false);
      setSelectedNodes(new Set());
      setSelectedEdges(new Set());
    }
  };

  const handleCurrentNodeLabelChanged = (label: string) => {
    // console.log("label changed to", label);
    if (selectedNodes.size === 1) {
      setCurrentNodeLabel(label);

      if (graph !== undefined && isValidDelimString("{" + label + "}")) {
        const [n] = selectedNodes;
        const g = graph.updateNodeData(n, d => d.setLabel(label));
        handleGraphChange(g, true);
      }
    }
  };

  const handleNodeStyleChanged = (style: string, apply: boolean) => {
    setCurrentNodeStyle(style);
    if (apply) {
      let g = graph;
      g = g.mapEdgeData(d => {
        let d1 = d;
        if (selectedNodes.has(d.source)) {
          const oldStyle = g.node(d.source)?.property("style");
          if (style === "none" && oldStyle !== "none" && d1.sourceAnchor === undefined) {
            d1 = d1.setSourceAnchor("center");
          } else if (style !== "none" && oldStyle === "none" && d1.sourceAnchor === "center") {
            d1 = d1.setSourceAnchor(undefined);
          }
        }

        if (selectedNodes.has(d.target)) {
          const oldStyle = g.node(d.target)?.property("style");
          if (style === "none" && oldStyle !== "none" && d1.targetAnchor === undefined) {
            d1 = d1.setTargetAnchor("center");
          } else if (style !== "none" && oldStyle === "none" && d1.targetAnchor === "center") {
            d1 = d1.setTargetAnchor(undefined);
          }
        }
        return d1;
      });

      g = g.mapNodeData(d => (selectedNodes.has(d.id) ? d.setProperty("style", style) : d));

      handleGraphChange(g, true);
    }

    document.getElementById("graph-editor")?.focus();
  };

  const handleEdgeStyleChanged = (style: string, apply: boolean) => {
    setCurrentEdgeStyle(style);
    if (apply) {
      const g = graph.mapEdgeData(d => {
        if (selectedPaths.has(d.path)) {
          if (style === "none") {
            return d.unset("style");
          } else {
            return d.setProperty("style", style);
          }
        }
        return d;
      });
      handleGraphChange(g, true);
    }

    document.getElementById("graph-editor")?.focus();
  };

  // The figure file emits a function named after its file basename so the
  // user can `#import "figures/foo.typ": *` and call `#foo()` from main.typ.
  // The funcName is computed by the extension and threaded through
  // initialContent; we fall back to a generic identifier if it's missing.
  const funcName = initialContent.documentName ?? "figure-content";

  // Newly-created figure files start out empty. The barrel file already
  // imports the figure's function by name (`#import "foo.typ": foo`), so an
  // empty file means the import resolves to nothing and Tinymist errors
  // until the user places a first node. Eagerly write the canonical empty
  // template on first open so the function is defined from the start. We
  // gate on truly empty (whitespace-only) input so we don't clobber any
  // hand-written content the user may have started with.
  useEffect(() => {
    if (initialContent.document.trim() === "") {
      host.updateFromGui(new Graph().cetzit(funcName));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // handle a graph change from the graph editor. "commit" says the document should be updated
  // and an undo step registered.
  const handleGraphChange = (g: Graph, commit: boolean) => {
    setGraph(g);

    if (commit) {
      // Snapshot the pre-change content + selection so that VS Code's
      // text-edit undo also restores the selection that was active at
      // this point. `graph` (closure) is the OLD graph state; serialising
      // it yields the exact text the user would rewind to via cmd-Z.
      const priorContent = graph.cetzit(funcName);
      selectionHistory.current.push({
        content: priorContent,
        selectedNodes: new Set(selectedNodes),
        selectedEdges: new Set(selectedEdges),
      });
      if (selectionHistory.current.length > MAX_SELECTION_HISTORY) {
        selectionHistory.current.shift();
      }

      const value = g.cetzit(funcName);
      updateFromGui(value);
    }
  };

  const handleSelectionChanged = (selectedNodes: Set<number>, selectedEdges: Set<number>) => {
    setSelectedNodes(selectedNodes);
    setSelectedEdges(selectedEdges);

    if (selectedNodes.size === 1) {
      const [n] = selectedNodes;
      setCurrentNodeLabel(graph.node(n)?.label);
    } else {
      setCurrentNodeLabel(undefined);
    }
  };

  const handleViewTikz = () => {
    let position = { line: 0, column: 0 };
    if (selectedNodes.size > 0) {
      const [node] = selectedNodes;
      const pos = graph.cetzitWithPosition(node, undefined, funcName)[1]!;
      if (pos !== undefined) {
        position = pos;
      }
    } else if (selectedEdges.size > 0) {
      const [edge] = selectedEdges;
      const pos = graph.cetzitWithPosition(undefined, edge, funcName)[1]!;
      if (pos !== undefined) {
        position = pos;
      }
    }

    host.openCodeEditor(position);
  };

  return (
    <div style={{ height: "100%", width: "100%" }}>
      <Splitpane splitRatio={0.8} orientation="horizontal" showSecondPanel={showSecondPanel}>
        <div style={{ height: "100%" }}>
          <Toolbar
            tool={tool}
            onToolChanged={t => {
              // Toolbar click is an explicit mode change; clear any
              // current selection so leftover state from the previous
              // mode doesn't bleed into the new one. Matches the same
              // behaviour in GraphEditor's handleCommand for the
              // keybinding-driven tool switches.
              if (t !== tool) {
                handleSelectionChanged(new Set(), new Set());
              }
              setTool(t);
              document.getElementById("graph-editor")?.focus();
            }}
          />
          <GraphEditor
            tool={tool}
            onToolChanged={setTool}
            enabled={enabled}
            graph={graph}
            onGraphChange={handleGraphChange}
            selectedNodes={selectedNodes}
            selectedEdges={selectedEdges}
            onSelectionChanged={handleSelectionChanged}
            onViewTikz={handleViewTikz}
            tikzStyles={tikzStyles}
            currentNodeStyle={currentNodeStyle}
            currentEdgeStyle={currentEdgeStyle}
            toggleStylePanel={toggleStylePanel}
          />
        </div>
        <StylePanel
          tikzStyles={tikzStyles}
          editMode={false}
          error={tikzStylesError}
          currentNodeStyle={currentNodeStyle}
          currentEdgeStyle={currentEdgeStyle}
          onNodeStyleChanged={handleNodeStyleChanged}
          onEdgeStyleChanged={handleEdgeStyleChanged}
          currentNodeLabel={currentNodeLabel}
          onCurrentNodeLabelChanged={handleCurrentNodeLabelChanged}
          onEditStyles={openTikzStyles}
          onRefreshStyles={refreshTikzStyles}
        />
      </Splitpane>
    </div>
  );
};

export default FigureEditor;
export { FigureEditorContent };
