interface MenuProps {
  onCommand: (commandName: string) => void;
}

const Menu = ({ onCommand }: MenuProps) => {
  return (
    <div className="menu">
      <button onClick={() => onCommand("cetzit.gui.selectAll")}>Select All</button>
      <button onClick={() => onCommand("cetzit.gui.deselectAll")}>Deselect All</button>
      <button onClick={() => onCommand("cetzit.gui.nudgeLeft")}>Nudge Left</button>
    </div>
  );
};

export default Menu;
