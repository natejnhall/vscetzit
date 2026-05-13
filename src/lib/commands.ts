interface Command {
  name: string;
  shortcuts: string[];
  description: string;
}

const commands: Command[] = [
  { name: "cetzit.gui.showHelp", shortcuts: ["Shift+?"], description: "Show help" },
  { name: "cetzit.gui.selectTool", shortcuts: ["S"], description: "Select tool" },
  { name: "cetzit.gui.nodeTool", shortcuts: ["N"], description: "Node tool" },
  { name: "cetzit.gui.edgeTool", shortcuts: ["E"], description: "Edge tool" },
  { name: "cetzit.gui.delete", shortcuts: ["Delete"], description: "Delete items" },
  { name: "cetzit.gui.zoomOut", shortcuts: ["-", "_"], description: "Zoom out" },
  { name: "cetzit.gui.zoomIn", shortcuts: ["Plus", "="], description: "Zoom in" },
  { name: "cetzit.gui.cut", shortcuts: ["Ctrl+X"], description: "Cut" },
  { name: "cetzit.gui.copy", shortcuts: ["Ctrl+C"], description: "Copy" },
  { name: "cetzit.gui.paste", shortcuts: ["Ctrl+V"], description: "Paste" },
  { name: "cetzit.gui.viewTikzSource", shortcuts: ["Ctrl+Alt+T"], description: "View TikZ source" },
  { name: "cetzit.gui.selectAll", shortcuts: ["Ctrl+A"], description: "Select all" },
  { name: "cetzit.gui.deselectAll", shortcuts: ["Ctrl+D"], description: "Deselect all" },
  {
    name: "cetzit.gui.extendSelectionLeft",
    shortcuts: ["Shift+ArrowLeft"],
    description: "Extend selection left",
  },
  {
    name: "cetzit.gui.extendSelectionRight",
    shortcuts: ["Shift+ArrowRight"],
    description: "Extend selection left",
  },
  {
    name: "cetzit.gui.extendSelectionUp",
    shortcuts: ["Shift+ArrowUp"],
    description: "Extend selection up",
  },
  {
    name: "cetzit.gui.extendSelectionDown",
    shortcuts: ["Shift+ArrowDown"],
    description: "Extend selection down",
  },
  { name: "cetzit.gui.moveLeft", shortcuts: ["Ctrl+ArrowLeft"], description: "Move left" },
  { name: "cetzit.gui.moveRight", shortcuts: ["Ctrl+ArrowRight"], description: "Move right" },
  { name: "cetzit.gui.moveUp", shortcuts: ["Ctrl+ArrowUp"], description: "Move up" },
  { name: "cetzit.gui.moveDown", shortcuts: ["Ctrl+ArrowDown"], description: "Move down" },
  { name: "cetzit.gui.nudgeLeft", shortcuts: ["Ctrl+Shift+ArrowLeft"], description: "Nudge left" },
  { name: "cetzit.gui.nudgeRight", shortcuts: ["Ctrl+Shift+ArrowRight"], description: "Nudge right" },
  { name: "cetzit.gui.nudgeUp", shortcuts: ["Ctrl+Shift+ArrowUp"], description: "Nudge up" },
  { name: "cetzit.gui.nudgeDown", shortcuts: ["Ctrl+Shift+ArrowDown"], description: "Nudge down" },
  { name: "cetzit.gui.joinPaths", shortcuts: ["Ctrl+Alt+P"], description: "Join paths" },
  { name: "cetzit.gui.splitPaths", shortcuts: ["Ctrl+Alt+Shift+P"], description: "Split paths" },
  { name: "cetzit.gui.mergeNodes", shortcuts: ["Ctrl+M"], description: "Merge nodes" },
];

const getCommandFromShortcut = (shortcut: string): Command | undefined => {
  return commands.find(command => command.shortcuts.includes(shortcut));
};

// const commandForName = (name: string): Command | undefined => {
//   return commands.find(command => command.name === name);
// };

export { Command, commands, getCommandFromShortcut };
