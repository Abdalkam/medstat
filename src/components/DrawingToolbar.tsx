// src/components/DrawingToolbar.tsx
import { FONT_FAMILIES, type ToolType, type FontOptions } from "./CanvasBlackboard";

interface DrawingToolbarProps {
  activeTool: ToolType;
  onToolChange: (tool: ToolType) => void;
  penColor: string;
  onPenColorChange: (color: string) => void;
  penWidth: number;
  onPenWidthChange: (width: number) => void;
  eraserSize: number;
  onEraserSizeChange: (size: number) => void;
  fontOptions: FontOptions;
  onFontOptionsChange: (options: Partial<FontOptions>) => void;
  onClear: () => void;
  isTrainer: boolean;
  compact?: boolean;
}

const PEN_COLORS = ["#FFFFFF", "#FF0000", "#00FF00", "#0000FF", "#FFFF00", "#FF00FF", "#00FFFF", "#FF8800", "#888888", "#000000"];
const FONT_SIZES = [12, 16, 20, 24, 32, 40, 48, 64];
const FONT_WEIGHTS = [{ label: "Normal", value: "normal" }, { label: "Bold", value: "bold" }, { label: "Light", value: "300" }];
const FONT_STYLES = [{ label: "Normal", value: "normal" }, { label: "Italic", value: "italic" }];

const ToolButton: React.FC<{ active: boolean; onClick: () => void; title: string; children: React.ReactNode }> = ({ active, onClick, title, children }) => (
  <button onClick={onClick} title={title} style={{
    width: "40px", height: "40px", display: "flex", alignItems: "center", justifyContent: "center",
    background: active ? "#007AFF" : "#1A1A1A", color: "#fff", border: active ? "none" : "1px solid #444",
    borderRadius: "8px", cursor: "pointer", transition: "all 0.2s ease",
  }}>{children}</button>
);

const SectionLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <span style={{ color: "#888", fontSize: "11px", textTransform: "uppercase", letterSpacing: "1px" }}>{children}</span>
);

const ColorPicker: React.FC<{ colors: string[]; value: string; onChange: (c: string) => void }> = ({ colors, value, onChange }) => (
  <div style={{ display: "flex", flexWrap: "wrap", gap: "4px" }}>
    {colors.map(c => (
      <button key={c} onClick={() => onChange(c)} style={{
        width: "24px", height: "24px", borderRadius: "50%", background: c,
        border: value === c ? "2px solid #007AFF" : "2px solid #444", cursor: "pointer", padding: 0,
      }} />
    ))}
    <label style={{
      width: "24px", height: "24px", borderRadius: "50%", background: "conic-gradient(red, yellow, lime, aqua, blue, magenta, red)",
      border: "2px solid #444", cursor: "pointer", position: "relative", overflow: "hidden",
    }}>
      <input type="color" value={value} onChange={e => onChange(e.target.value)} style={{ position: "absolute", opacity: 0, width: "100%", height: "100%", cursor: "pointer" }} />
    </label>
  </div>
);

const SelectInput: React.FC<{ value: string | number; onChange: (v: string) => void; children: React.ReactNode }> = ({ value, onChange, children }) => (
  <select value={value} onChange={e => onChange(e.target.value)} style={{
    background: "#1A1A1A", color: "#fff", border: "1px solid #444", borderRadius: "6px", padding: "6px 8px", fontSize: "13px", cursor: "pointer", width: "100%",
  }}>{children}</select>
);

export const DrawingToolbar: React.FC<DrawingToolbarProps> = ({
  activeTool, onToolChange, penColor, onPenColorChange, penWidth, onPenWidthChange,
  eraserSize, onEraserSizeChange, fontOptions, onFontOptionsChange, onClear, isTrainer, compact = false,
}) => {
  if (!isTrainer) return null;

  return (
    <div style={{
      display: "flex", flexDirection: "column", gap: compact ? "8px" : "12px",
      padding: compact ? "8px" : "12px", background: "#2A2A2A", borderRadius: "12px",
      boxShadow: "0 4px 12px rgba(0,0,0,0.3)", maxHeight: "90vh", overflowY: "auto",
    }}>
      {/* Tools */}
      <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
        <SectionLabel>Tools</SectionLabel>
        <div style={{ display: "flex", gap: "4px" }}>
          <ToolButton active={activeTool === "pen"} onClick={() => onToolChange("pen")} title="Pen">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" /></svg>
          </ToolButton>
          <ToolButton active={activeTool === "eraser"} onClick={() => onToolChange("eraser")} title="Eraser">
            <svg width="20" height="20" viewBox="0 0 60 70" fill="none">
              <rect x="15" y="10" width="30" height="25" rx="2" fill="currentColor" />
              <rect x="12" y="35" width="36" height="12" rx="2" fill="currentColor" opacity="0.7" />
              <rect x="22" y="47" width="16" height="15" rx="3" fill="currentColor" opacity="0.5" />
            </svg>
          </ToolButton>
          <ToolButton active={activeTool === "text"} onClick={() => onToolChange("text")} title="Text">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="4 7 4 4 20 4 20 7" /><line x1="9" y1="20" x2="15" y2="20" /><line x1="12" y1="4" x2="12" y2="20" />
            </svg>
          </ToolButton>
        </div>
      </div>

      {/* Pen Options */}
      {activeTool === "pen" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          <SectionLabel>Pen Color</SectionLabel>
          <ColorPicker colors={PEN_COLORS} value={penColor} onChange={onPenColorChange} />
          <SectionLabel>Pen Size: {penWidth}px</SectionLabel>
          <input type="range" min="1" max="20" value={penWidth} onChange={e => onPenWidthChange(Number(e.target.value))} style={{ width: "100%", accentColor: "#007AFF" }} />
        </div>
      )}

      {/* Eraser Options */}
      {activeTool === "eraser" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          <SectionLabel>Eraser Size: {eraserSize}px</SectionLabel>
          <input type="range" min="10" max="100" value={eraserSize} onChange={e => onEraserSizeChange(Number(e.target.value))} style={{ width: "100%", accentColor: "#007AFF" }} />
          <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: eraserSize + 20 }}>
            <div style={{ width: eraserSize, height: eraserSize, borderRadius: "50%", border: "2px dashed rgba(255,255,255,0.5)" }} />
          </div>
        </div>
      )}

      {/* Text Options */}
      {activeTool === "text" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          <SectionLabel>Font Family</SectionLabel>
          <SelectInput value={fontOptions.fontFamily} onChange={v => onFontOptionsChange({ fontFamily: v })}>
            {FONT_FAMILIES.map(f => <option key={f} value={f} style={{ fontFamily: f }}>{f}</option>)}
          </SelectInput>

          <SectionLabel>Font Size: {fontOptions.fontSize}px</SectionLabel>
          <SelectInput value={fontOptions.fontSize} onChange={v => onFontOptionsChange({ fontSize: Number(v) })}>
            {FONT_SIZES.map(s => <option key={s} value={s}>{s}px</option>)}
          </SelectInput>

          <SectionLabel>Weight</SectionLabel>
          <div style={{ display: "flex", gap: "4px" }}>
            {FONT_WEIGHTS.map(w => (
              <button key={w.value} onClick={() => onFontOptionsChange({ fontWeight: w.value })} style={{
                flex: 1, padding: "6px", background: fontOptions.fontWeight === w.value ? "#007AFF" : "#1A1A1A",
                color: "#fff", border: "1px solid #444", borderRadius: "6px", cursor: "pointer", fontSize: "12px", fontWeight: w.value as React.CSSProperties["fontWeight"],
              }}>{w.label}</button>
            ))}
          </div>

          <SectionLabel>Style</SectionLabel>
          <div style={{ display: "flex", gap: "4px" }}>
            {FONT_STYLES.map(s => (
              <button key={s.value} onClick={() => onFontOptionsChange({ fontStyle: s.value })} style={{
                flex: 1, padding: "6px", background: fontOptions.fontStyle === s.value ? "#007AFF" : "#1A1A1A",
                color: "#fff", border: "1px solid #444", borderRadius: "6px", cursor: "pointer", fontSize: "12px", fontStyle: s.value,
              }}>{s.label}</button>
            ))}
          </div>

          <SectionLabel>Text Color</SectionLabel>
          <ColorPicker colors={PEN_COLORS.slice(0, 6)} value={fontOptions.fontColor} onChange={c => onFontOptionsChange({ fontColor: c })} />

          <div style={{ padding: "12px", background: "#1A1A1A", borderRadius: "8px", border: "1px solid #444" }}>
            <span style={{
              fontFamily: fontOptions.fontFamily, fontSize: Math.min(fontOptions.fontSize, 24),
              fontWeight: fontOptions.fontWeight as React.CSSProperties["fontWeight"],
              fontStyle: fontOptions.fontStyle, color: fontOptions.fontColor,
            }}>Sample Text</span>
          </div>
        </div>
      )}

      {/* Clear */}
      <button onClick={onClear} style={{
        padding: "10px", background: "#FF4444", color: "#fff", border: "none", borderRadius: "8px",
        cursor: "pointer", fontSize: "13px", fontWeight: "bold", display: "flex", alignItems: "center",
        justifyContent: "center", gap: "6px", marginTop: "8px",
      }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
        </svg>
        Clear All
      </button>
    </div>
  );
};

export default DrawingToolbar;