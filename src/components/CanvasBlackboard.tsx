// src/components/CanvasBlackboard.tsx
import { useEffect, useRef, useState, useCallback, forwardRef, useImperativeHandle } from "react";
import { supabase } from "../auth/supabase";

export type { Point, Stroke, TextItem, ToolType, FontOptions } from "./DrawingBlackboard";
export { FONT_FAMILIES } from "./DrawingBlackboard";
import type { ToolType, FontOptions, TextItem } from "./DrawingBlackboard";

interface DrawPayload {
  type: 'start' | 'draw' | 'stop' | 'clear' | 'erase-point' | 'text-add';
  x: number;
  y: number;
  angle?: number;
  color?: string;
  width?: number;
  eraserSize?: number;
  textItem?: TextItem;
}

export interface CanvasBlackboardHandle {
  clearBoard: () => void;
  setTool: (tool: ToolType) => void;
  setFontOptions: (options: Partial<FontOptions>) => void;
  setPenColor: (color: string) => void;
  setPenWidth: (width: number) => void;
  setEraserSize: (size: number) => void;
}

interface CanvasBlackboardProps {
  isTrainer?: boolean;
  courseId: string;
  initialTool?: ToolType;
  initialFontOptions?: Partial<FontOptions>;
  initialPenColor?: string;
  initialPenWidth?: number;
  initialEraserSize?: number;
}

export const CanvasBlackboard = forwardRef<CanvasBlackboardHandle, CanvasBlackboardProps>(
  ({ isTrainer, courseId, initialTool = 'pen', initialFontOptions, initialPenColor = '#FFFFFF', initialPenWidth = 3, initialEraserSize = 30 }, ref) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [activeTool, setActiveTool] = useState<ToolType>(initialTool);
    const [isDrawing, setIsDrawing] = useState(false);
    const [handPos, setHandPos] = useState({ x: 0, y: 0, angle: 0, visible: false });
    const [cursorPos, setCursorPos] = useState<{ x: number; y: number } | null>(null);
    const [penColor, setPenColor] = useState(initialPenColor);
    const [penWidth, setPenWidth] = useState(initialPenWidth);
    const [eraserSize, setEraserSize] = useState(initialEraserSize);
    const [fontOptions, setFontOptions] = useState<FontOptions>({ fontFamily: 'Arial', fontSize: 24, fontColor: '#FFFFFF', fontWeight: 'normal', fontStyle: 'normal', ...initialFontOptions });
    const [activeTextInput, setActiveTextInput] = useState<TextItem | null>(null);
    const [textItems, setTextItems] = useState<TextItem[]>([]);
    const inputRef = useRef<HTMLTextAreaElement>(null);
    const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

    const getCtx = useCallback(() => canvasRef.current?.getContext("2d") || null, []);

    const drawTextOnCanvas = useCallback((ctx: CanvasRenderingContext2D, t: TextItem) => {
      if (!t.text) return;
      ctx.save();
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = t.fontColor;
      ctx.font = `${t.fontStyle} ${t.fontWeight} ${t.fontSize}px ${t.fontFamily}`;
      ctx.textBaseline = "top";
      t.text.split("\n").forEach((line, i) => ctx.fillText(line, t.x, t.y + i * t.fontSize * 1.2));
      ctx.restore();
    }, []);

    useImperativeHandle(ref, () => ({
      clearBoard: () => {
        if (!isTrainer) return;
        const ctx = getCtx();
        if (ctx && canvasRef.current) {
          ctx.fillStyle = "#1A1A1A";
          ctx.fillRect(0, 0, canvasRef.current.width, canvasRef.current.height);
          textItems.forEach(t => drawTextOnCanvas(ctx, t));
        }
        channelRef.current?.send({ type: "broadcast", event: "draw-event", payload: { type: "clear", x: 0, y: 0 } });
      },
      setTool: (tool: ToolType) => { setActiveTool(tool); setActiveTextInput(null); },
      setFontOptions: (options: Partial<FontOptions>) => setFontOptions(prev => ({ ...prev, ...options })),
      setPenColor: setPenColor,
      setPenWidth: setPenWidth,
      setEraserSize: setEraserSize,
    }), [isTrainer, getCtx, textItems, drawTextOnCanvas]);

    useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = getCtx();
      if (!ctx) return;

      const resizeCanvas = () => {
        const parent = canvas.parentElement;
        if (!parent) return;
        let imageData: ImageData | null = null;
        try { imageData = ctx.getImageData(0, 0, canvas.width, canvas.height); } catch {}
        canvas.width = parent.clientWidth;
        canvas.height = parent.clientHeight;
        ctx.fillStyle = "#1A1A1A";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        if (imageData) ctx.putImageData(imageData, 0, 0);
        textItems.forEach(t => drawTextOnCanvas(ctx, t));
      };

      resizeCanvas();
      window.addEventListener("resize", resizeCanvas);
      channelRef.current = supabase.channel(`whiteboard-${courseId}`);

      if (!isTrainer) {
        channelRef.current.on("broadcast", { event: "draw-event" }, ({ payload }) => {
          const d = payload as DrawPayload;
          const c = getCtx();
          if (!c) return;
          if (d.type === "start") {
            c.save();
            c.globalCompositeOperation = 'source-over';
            c.strokeStyle = d.color || "#FFFFFF";
            c.lineWidth = d.width || 3;
            c.lineCap = 'round';
            c.lineJoin = 'round';
            c.beginPath();
            c.moveTo(d.x, d.y);
            c.restore();
          } else if (d.type === "draw") {
            c.save();
            c.globalCompositeOperation = 'source-over';
            c.strokeStyle = d.color || "#FFFFFF";
            c.lineWidth = d.width || 3;
            c.lineCap = 'round';
            c.lineJoin = 'round';
            c.lineTo(d.x, d.y);
            c.stroke();
            c.beginPath();
            c.moveTo(d.x, d.y);
            c.restore();
          } else if (d.type === "erase-point") {
            c.save();
            c.globalCompositeOperation = 'destination-out';
            c.beginPath();
            c.arc(d.x, d.y, (d.eraserSize || 30) / 2, 0, Math.PI * 2);
            c.fill();
            c.restore();
          } else if (d.type === "clear") {
            c.fillStyle = "#1A1A1A";
            c.fillRect(0, 0, canvas.width, canvas.height);
          } else if (d.type === "text-add" && d.textItem) {
            drawTextOnCanvas(c, d.textItem);
          }
        }).subscribe();
      } else {
        channelRef.current.subscribe();
      }

      return () => {
        window.removeEventListener("resize", resizeCanvas);
        if (channelRef.current) supabase.removeChannel(channelRef.current);
      };
    }, [courseId, isTrainer, getCtx, textItems, drawTextOnCanvas]);

    const getPos = (e: React.MouseEvent | React.TouchEvent) => {
      const rect = canvasRef.current!.getBoundingClientRect();
      if ("touches" in e) return { x: e.touches[0].clientX - rect.left, y: e.touches[0].clientY - rect.top };
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };

    const broadcast = (payload: DrawPayload) => { isTrainer && channelRef.current?.send({ type: "broadcast", event: "draw-event", payload }); };

    const handleTextClick = (e: React.MouseEvent | React.TouchEvent) => {
      if (!isTrainer || activeTool !== "text") return;
      const pos = getPos(e);
      const clickedText = textItems.find(t => {
        const ctx = getCtx();
        if (!ctx) return false;
        ctx.font = `${t.fontStyle} ${t.fontWeight} ${t.fontSize}px ${t.fontFamily}`;
        const w = ctx.measureText(t.text).width;
        const h = t.text.split("\n").length * t.fontSize * 1.2;
        return pos.x >= t.x - 5 && pos.x <= t.x + w + 10 && pos.y >= t.y - 5 && pos.y <= t.y + h + 10;
      });
      setActiveTextInput(clickedText || { id: `text-${Date.now()}`, x: pos.x, y: pos.y, text: '', ...fontOptions });
    };

    const handleTextBlur = () => {
      if (activeTextInput?.text.trim()) {
        const ctx = getCtx();
        if (ctx) drawTextOnCanvas(ctx, activeTextInput);
        setTextItems(prev => {
          const idx = prev.findIndex(t => t.id === activeTextInput.id);
          if (idx >= 0) { const u = [...prev]; u[idx] = activeTextInput; return u; }
          return [...prev, activeTextInput];
        });
        broadcast({ type: "text-add", x: 0, y: 0, textItem: activeTextInput });
      }
      setActiveTextInput(null);
    };

    useEffect(() => { activeTextInput && inputRef.current?.focus(); }, [activeTextInput]);

    const startDrawing = (e: React.MouseEvent | React.TouchEvent) => {
      if (!isTrainer) return;
      e.preventDefault();
      if (activeTool === "text") { handleTextClick(e); return; }
      const pos = getPos(e);
      const ctx = getCtx();
      if (activeTool === "eraser") {
        if (ctx) {
          ctx.save();
          ctx.globalCompositeOperation = 'destination-out';
          ctx.beginPath();
          ctx.arc(pos.x, pos.y, eraserSize / 2, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
        broadcast({ type: "erase-point", x: pos.x, y: pos.y, eraserSize });
      } else {
        if (ctx) {
          ctx.save();
          ctx.globalCompositeOperation = 'source-over';
          ctx.strokeStyle = penColor;
          ctx.lineWidth = penWidth;
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          ctx.beginPath();
          ctx.moveTo(pos.x, pos.y);
          ctx.restore();
        }
        broadcast({ type: "start", x: pos.x, y: pos.y, color: penColor, width: penWidth });
      }
      setIsDrawing(true);
      setHandPos({ x: pos.x, y: pos.y, angle: handPos.angle, visible: activeTool === "pen" });
    };

    const draw = (e: React.MouseEvent | React.TouchEvent) => {
      if (!isTrainer) return;
      if ("touches" in e) e.preventDefault();
      const pos = getPos(e);
      if (activeTool === "eraser") {
        setCursorPos(pos);
        if (!isDrawing) return;
        const ctx = getCtx();
        if (ctx) {
          ctx.save();
          ctx.globalCompositeOperation = 'destination-out';
          ctx.beginPath();
          ctx.arc(pos.x, pos.y, eraserSize / 2, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
        broadcast({ type: "erase-point", x: pos.x, y: pos.y, eraserSize });
        return;
      }
      if (activeTool === "text") return;
      if (!isDrawing) return;
      const ctx = getCtx();
      if (ctx) {
        ctx.save();
        ctx.globalCompositeOperation = 'source-over';
        ctx.strokeStyle = penColor;
        ctx.lineWidth = penWidth;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.lineTo(pos.x, pos.y);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(pos.x, pos.y);
        ctx.restore();
      }
      const dx = pos.x - handPos.x, dy = pos.y - handPos.y;
      setHandPos({ x: pos.x, y: pos.y, angle: Math.atan2(dy, dx) * (180 / Math.PI), visible: true });
      broadcast({ type: "draw", x: pos.x, y: pos.y, angle: Math.atan2(dy, dx) * (180 / Math.PI), color: penColor, width: penWidth });
    };

    const stopDrawing = () => {
      if (!isTrainer) return;
      setIsDrawing(false);
      setHandPos(prev => ({ ...prev, visible: false }));
      broadcast({ type: "stop", x: 0, y: 0 });
    };

    const getCursorStyle = () => !isTrainer ? "default" : activeTool === "eraser" ? "none" : activeTool === "text" ? "text" : "none";

    return (
      <div style={{ width: "100%", height: "100%", position: "relative", overflow: "hidden", borderRadius: "12px", touchAction: "none", background: "#1A1A1A" }}>
        <canvas
          ref={canvasRef}
          style={{ width: "100%", height: "100%", display: "block", cursor: getCursorStyle() }}
          onMouseDown={startDrawing}
          onMouseMove={draw}
          onMouseUp={stopDrawing}
          onMouseLeave={() => { stopDrawing(); setCursorPos(null); }}
          onTouchStart={startDrawing}
          onTouchMove={draw}
          onTouchEnd={stopDrawing}
        />
        {isTrainer && activeTool === "pen" && handPos.visible && (
          <div style={{ position: "absolute", left: handPos.x, top: handPos.y, transform: `translate(-15%, -90%) rotate(${handPos.angle + 45}deg)`, pointerEvents: "none", zIndex: 10, filter: "drop-shadow(2px 4px 4px rgba(0,0,0,0.5))" }}>
            <svg width="80" height="80" viewBox="0 0 100 100" fill="none">
              <rect x="10" y="50" width="8" height="40" rx="2" fill="#333" />
              <polygon points="10,50 18,50 14,35" fill="#007AFF" />
              <path d="M 20 80 C 20 60, 40 50, 50 60 L 80 20 C 85 15, 95 20, 90 25 L 60 65 C 70 75, 60 95, 40 90 C 30 85, 20 85, 20 80 Z" fill="#F0C2A0" stroke="#D8A07A" strokeWidth="1.5" />
              <path d="M 15 85 C 15 75, 25 70, 35 75 L 35 100 L 10 100 Z" fill="#3C3C43" />
            </svg>
          </div>
        )}
        {isTrainer && activeTool === "eraser" && cursorPos && (
          <div style={{ position: "absolute", left: cursorPos.x, top: cursorPos.y, transform: "translate(-50%, -50%)", pointerEvents: "none", zIndex: 10 }}>
            <svg width={eraserSize + 10} height={eraserSize + 20} viewBox="0 0 60 70" fill="none">
              <rect x="10" y="5" width="40" height="35" rx="3" fill="#FFD700" stroke="#DAA520" strokeWidth="2" />
              <rect x="15" y="8" width="30" height="10" rx="1" fill="#FFE44D" />
              <rect x="8" y="35" width="44" height="15" rx="2" fill="#FF6B6B" stroke="#E05555" strokeWidth="1.5" />
              <line x1="15" y1="38" x2="15" y2="47" stroke="#E05555" strokeWidth="1" />
              <line x1="25" y1="38" x2="25" y2="47" stroke="#E05555" strokeWidth="1" />
              <line x1="35" y1="38" x2="35" y2="47" stroke="#E05555" strokeWidth="1" />
              <line x1="45" y1="38" x2="45" y2="47" stroke="#E05555" strokeWidth="1" />
              <rect x="22" y="50" width="16" height="18" rx="3" fill="#8B4513" stroke="#6B3410" strokeWidth="1.5" />
            </svg>
            <div style={{ position: "absolute", bottom: -10, left: "50%", transform: "translateX(-50%)", width: eraserSize, height: eraserSize, borderRadius: "50%", border: "2px dashed rgba(255,255,255,0.4)" }} />
          </div>
        )}
        {isTrainer && activeTextInput && (
          <textarea
            ref={inputRef}
            value={activeTextInput.text}
            onChange={(e) => setActiveTextInput({ ...activeTextInput, text: e.target.value })}
            onBlur={handleTextBlur}
            onKeyDown={(e) => { if (e.key === 'Escape') handleTextBlur(); }}
            style={{
              position: "absolute", left: activeTextInput.x, top: activeTextInput.y,
              background: "rgba(0,0,0,0.3)", border: "2px dashed rgba(255,255,255,0.5)", color: activeTextInput.fontColor,
              fontFamily: activeTextInput.fontFamily, fontSize: `${activeTextInput.fontSize}px`,
              fontWeight: activeTextInput.fontWeight as React.CSSProperties["fontWeight"], fontStyle: activeTextInput.fontStyle,
              padding: "4px 8px", resize: "none", outline: "none", minWidth: "150px", minHeight: "40px", zIndex: 30, lineHeight: 1.2,
            }}
          />
        )}
      </div>
    );
  }
);

CanvasBlackboard.displayName = "CanvasBlackboard";