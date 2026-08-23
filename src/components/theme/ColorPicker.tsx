// 纯色选择器：预设色板 + 原生取色器（零依赖、轻量）。
import "./color-picker.css";

const SWATCHES = [
  "#ffffff", "#fffdf8", "#f5f3ed", "#f0ebe0", "#e8e6dc",
  "#4a7c59", "#6b9a74", "#a8c3a0", "#d7e4d0",
  "#f9a620", "#b7472a", "#2b2b28", "#6b6b63", "#1a1a1a",
];

export function ColorPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (color: string) => void;
}) {
  return (
    <div className="qj-color-picker">
      <div className="qj-color-swatches">
        {SWATCHES.map((c) => (
          <button
            key={c}
            type="button"
            className={`qj-color-swatch${value === c ? " is-active" : ""}`}
            style={{ background: c }}
            title={c}
            onClick={() => onChange(c)}
          />
        ))}
      </div>
      <label className="qj-color-native">
        <input
          type="color"
          value={/^#[0-9a-f]{6}$/i.test(value) ? value : "#4a7c59"}
          onChange={(e) => onChange(e.target.value)}
        />
        <span>{value}</span>
      </label>
    </div>
  );
}
