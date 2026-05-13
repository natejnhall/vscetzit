import { StyleData } from "../lib/Data";
import { colorFromHex, colorToHex, texColors } from "../lib/color";
import ColorPicker from "./ColorPicker";
import InputWithOptions from "./InputWithOptions";

interface StyleProps {
  data: StyleData;
  onChange: (newData: StyleData) => void;
  enabled: boolean;
}

const Style = ({ data, onChange, enabled }: StyleProps) => {
  const setColor = (property: string, color: string) => {
    if (color === "") {
      onChange(data.unset(property));
    } else {
      const hex = colorFromHex(color) ?? color;
      onChange(data.setProperty(property, typstColorLiteral(hex)));
    }
  };

  const colorNameOrHex = (property: string): string => {
    const c = stripTypst(data.property(property));
    if (c === undefined) return "";
    if (c in texColors) return c;
    return colorToHex(c) ?? c;
  };

  const colorHex = (property: string): string | undefined => {
    const c = stripTypst(data.property(property));
    return colorToHex(c);
  };

  const shapeRaw = data.property("shape") ?? "";
  const shapeValue = shapeRaw.replace(/^"|"$/g, "");

  return (
    <div style={{ width: "80%", maxWidth: "400px", margin: "auto" }}>
      <table className="style-table">
        <tr>
          <td className="form-label">name</td>
          <td>
            <input
              disabled={!enabled}
              style={{ width: "100%" }}
              value={data.name}
              onInput={e => onChange(data.setName((e.target as HTMLInputElement).value))}
            />
          </td>
        </tr>
        <tr>
          <td className="form-label">stroke</td>
          <td>
            <input
              disabled={!enabled}
              style={{ width: "100px" }}
              value={colorNameOrHex("stroke")}
              onInput={e => setColor("stroke", (e.target as HTMLInputElement).value)}
            />{" "}
            &nbsp;
            <ColorPicker
              disabled={!enabled}
              value={colorHex("stroke")}
              onChange={c => setColor("stroke", c)}
            />
          </td>
        </tr>
        <tr>
          <td className="form-label">fill</td>
          <td>
            <input
              disabled={!enabled}
              style={{ width: "100px" }}
              value={colorNameOrHex("fill")}
              onInput={e => setColor("fill", (e.target as HTMLInputElement).value)}
            />{" "}
            &nbsp;
            <ColorPicker
              disabled={!enabled}
              value={colorHex("fill")}
              onChange={c => setColor("fill", c)}
            />
          </td>
        </tr>
        <tr>
          <td className="form-label">shape</td>
          <td>
            <InputWithOptions
              disabled={!enabled}
              style={{ width: "100%", height: "30px", marginTop: "8px" }}
              value={shapeValue}
              options={["pill", "circle", "rectangle"]}
              onChange={v => {
                if (v === "") {
                  onChange(data.unset("shape"));
                } else {
                  onChange(data.setProperty("shape", `"${v}"`));
                }
              }}
            />
          </td>
        </tr>
      </table>
    </div>
  );
};

function stripTypst(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  let s = raw.trim();
  const plus = s.indexOf("+");
  if (plus !== -1 && /pt\s*$/.test(s.slice(plus + 1))) {
    s = s.slice(0, plus).trim();
  }
  const m = s.match(/^rgb\s*\(([^)]*)\)$/);
  if (m) {
    const parts = m[1].split(",").map(p => p.trim());
    if (parts.length >= 3 && parts.every(p => /^\d+(?:\.\d+)?$/.test(p))) {
      const [r, g, b] = parts.slice(0, 3).map(Number);
      return `#${[r, g, b].map(c => c.toString(16).padStart(2, "0")).join("")}`;
    }
  }
  return s;
}

function typstColorLiteral(hex: string): string {
  const m = hex.match(/^#?([0-9a-fA-F]{6})$/);
  if (!m) return hex;
  const v = parseInt(m[1], 16);
  const r = (v >> 16) & 0xff;
  const g = (v >> 8) & 0xff;
  const b = v & 0xff;
  return `rgb(${r}, ${g}, ${b})`;
}

export default Style;
