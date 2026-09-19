// src/components/DrawingBlackboard.tsx
import { useEffect, useRef, useCallback, useMemo, useState } from "react";
import { supabase } from "../auth/supabase";

const CANVAS_WIDTH = 1280;
const CANVAS_HEIGHT = 720;

// ==================== SHARED TYPES ====================
export interface Point { x: number; y: number; }
// ✅ FIX: Added 'text' to the tool union type
export interface Stroke { id: string; points: Point[]; color?: string; width?: number; tool?: 'pen' | 'eraser' | 'text'; }
export interface TextItem { id: string; x: number; y: number; text: string; fontFamily: string; fontSize: number; fontColor: string; fontWeight: string; fontStyle: string; }
export type ToolType = 'pen' | 'eraser' | 'text';
export interface FontOptions { fontFamily: string; fontSize: number; fontColor: string; fontWeight: string; fontStyle: string; }

export const FONT_FAMILIES = ['Arial', 'Times New Roman', 'Courier New', 'Georgia', 'Verdana', 'Comic Sans MS', 'Impact', 'Trebuchet MS'];

interface DrawPayload {
  type: 'start' | 'draw' | 'stop' | 'clear' | 'erase-point' | 'text-add';
  x: number;
  y: number;
  color?: string;
  width?: number;
  eraserSize?: number;
  textItem?: TextItem;
}

// ==================== COMPONENT ====================
interface DrawingBlackboardProps {
  isTrainer: boolean;
  strokes: Stroke[];
  texts?: TextItem[];
  onStrokeEnd?: (points: Point[], tool: ToolType, color?: string, width?: number) => void;
  onErase?: (pos: Point, radius: number) => void;
  onTextAdd?: (text: TextItem) => void;
  activeTool?: ToolType;
  fontSize?: number;
  fontFamily?: string;
  fontColor?: string;
  fontWeight?: string;
  fontStyle?: string;
  penColor?: string;
  penWidth?: number;
  eraserSize?: number;
  courseId: string;
}

export default function DrawingBlackboard({
  isTrainer, strokes, texts = [], onStrokeEnd, onErase, onTextAdd, activeTool = 'pen',
  fontSize = 24, fontFamily = 'Arial', fontColor = '#FFFFFF', fontWeight = 'normal', fontStyle = 'normal',
  penColor = '#FFFFFF', penWidth = 4, eraserSize = 30, courseId,
}: DrawingBlackboardProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isDrawingRef = useRef(false);
  const currentPointsRef = useRef<Point[]>([]);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const [activeTextInput, setActiveTextInput] = useState<TextItem | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [cursorPos, setCursorPos] = useState<Point | null>(null);

  const strokeKey = useMemo(() => `${(strokes || []).length}-${(strokes || []).map(s => (s.points || []).length).join("-")}`, [strokes]);
  const textKey = useMemo(() => texts.map(t => `${t.id}-${t.text}`).join("|"), [texts]);

  // Redraw all saved strokes and texts from database
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#1A1A1A";
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    (strokes || []).forEach(s => {
      if (!s.points?.length) return;
      ctx.save();
      if (s.tool === 'eraser') {
        ctx.globalCompositeOperation = 'destination-out';
        ctx.lineWidth = s.width || eraserSize;
      } else {
        ctx.globalCompositeOperation = 'source-over';
        ctx.strokeStyle = s.color || '#FFFFFF';
        ctx.lineWidth = s.width || penWidth;
      }
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(s.points[0].x, s.points[0].y);
      for (let i = 1; i < s.points.length; i++) ctx.lineTo(s.points[i].x, s.points[i].y);
      ctx.stroke();
      ctx.restore();
    });
    texts.forEach(t => {
      if (!t.text) return;
      ctx.save();
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = t.fontColor;
      ctx.font = `${t.fontStyle} ${t.fontWeight} ${t.fontSize}px ${t.fontFamily}`;
      ctx.textBaseline = 'top';
      t.text.split('\n').forEach((line, i) => ctx.fillText(line, t.x, t.y + i * t.fontSize * 1.2));
      ctx.restore();
    });
  }, [strokes, texts, strokeKey, textKey, eraserSize, penWidth]);

  // Subscribe to real-time draw events
  useEffect(() => {
    if (!courseId) return;
    channelRef.current = supabase.channel(`whiteboard-${courseId}`);

    if (!isTrainer) {
      channelRef.current.on("broadcast", { event: "draw-event" }, ({ payload }) => {
        const d = payload as DrawPayload;
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext("2d");
        if (!canvas || !ctx) return;

        if (d.type === "start") {
          ctx.save();
          ctx.globalCompositeOperation = 'source-over';
          ctx.strokeStyle = d.color || '#FFFFFF';
          ctx.lineWidth = d.width || 4;
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          ctx.beginPath();
          ctx.moveTo(d.x, d.y);
          ctx.restore();
        } else if (d.type === "draw") {
          ctx.save();
          ctx.globalCompositeOperation = 'source-over';
          ctx.strokeStyle = d.color || '#FFFFFF';
          ctx.lineWidth = d.width || 4;
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          ctx.lineTo(d.x, d.y);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(d.x, d.y);
          ctx.restore();
        } else if (d.type === "erase-point") {
          ctx.save();
          ctx.globalCompositeOperation = 'destination-out';
          ctx.beginPath();
          ctx.arc(d.x, d.y, (d.eraserSize || 30) / 2, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        } else if (d.type === "clear") {
          ctx.fillStyle = "#1A1A1A";
          ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
        } else if (d.type === "text-add" && d.textItem) {
          ctx.save();
          ctx.globalCompositeOperation = 'source-over';
          ctx.fillStyle = d.textItem.fontColor;
          ctx.font = `${d.textItem.fontStyle} ${d.textItem.fontWeight} ${d.textItem.fontSize}px ${d.textItem.fontFamily}`;
          ctx.textBaseline = 'top';
          d.textItem.text.split('\n').forEach((line, i) => ctx.fillText(line, d.textItem!.x, d.textItem!.y + i * d.textItem!.fontSize * 1.2));
          ctx.restore();
        }
      }).subscribe();
    } else {
      channelRef.current.subscribe();
    }

    return () => {
      if (channelRef.current) supabase.removeChannel(channelRef.current);
    };
  }, [courseId, isTrainer]);

  const broadcast = (payload: DrawPayload) => {
    if (isTrainer && channelRef.current) {
      channelRef.current.send({ type: "broadcast", event: "draw-event", payload });
    }
  };

  const getPos = useCallback((e: React.MouseEvent | React.TouchEvent): Point => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const clientX = "touches" in e ? e.touches[0].clientX : e.clientX;
    const clientY = "touches" in e ? e.touches[0].clientY : e.clientY;
    return { x: (clientX - rect.left) * (CANVAS_WIDTH / rect.width), y: (clientY - rect.top) * (CANVAS_HEIGHT / rect.height) };
  }, []);

  const handleTextClick = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    if (!isTrainer || activeTool !== 'text') return;
    const pos = getPos(e);
    const clickedText = texts.find(t => {
      const ctx = canvasRef.current?.getContext("2d");
      if (!ctx) return false;
      ctx.font = `${t.fontStyle} ${t.fontWeight} ${t.fontSize}px ${t.fontFamily}`;
      const w = ctx.measureText(t.text).width;
      const h = t.text.split('\n').length * t.fontSize * 1.2;
      return pos.x >= t.x && pos.x <= t.x + w + 20 && pos.y >= t.y && pos.y <= t.y + h + 10;
    });
    setActiveTextInput(clickedText || { id: `text-${Date.now()}`, x: pos.x, y: pos.y, text: '', fontFamily, fontSize, fontColor, fontWeight, fontStyle });
  }, [isTrainer, activeTool, getPos, texts, fontFamily, fontSize, fontColor, fontWeight, fontStyle]);

  const handleTextInput = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    if (!activeTextInput) return;
    setActiveTextInput({ ...activeTextInput, text: e.target.value });
  }, [activeTextInput]);

  const handleTextBlur = useCallback(() => {
    if (activeTextInput?.text.trim() && onTextAdd) onTextAdd(activeTextInput);
    setActiveTextInput(null);
  }, [activeTextInput, onTextAdd]);

  useEffect(() => { activeTextInput && inputRef.current?.focus(); }, [activeTextInput]);

  const startDrawing = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    if (!isTrainer) return;
    e.preventDefault();
    if (activeTool === 'text') { handleTextClick(e); return; }
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const pos = getPos(e);

    if (activeTool === 'eraser') {
      ctx.save();
      ctx.globalCompositeOperation = 'destination-out';
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, eraserSize / 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      broadcast({ type: 'erase-point', x: pos.x, y: pos.y, eraserSize });
      onErase?.(pos, eraserSize);
    } else {
      ctx.save();
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = penColor;
      ctx.lineWidth = penWidth;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(pos.x, pos.y);
      ctx.restore();
      broadcast({ type: 'start', x: pos.x, y: pos.y, color: penColor, width: penWidth });
    }
    isDrawingRef.current = true;
    currentPointsRef.current = [pos];
  }, [isTrainer, activeTool, handleTextClick, getPos, eraserSize, penColor, penWidth, broadcast, onErase]);

  const draw = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    if (!isTrainer) return;
    e.preventDefault();
    if (activeTool === 'text') return;
    const pos = getPos(e);

    if (activeTool === 'eraser') {
      setCursorPos(pos);
      if (!isDrawingRef.current) return;
      const ctx = canvasRef.current?.getContext("2d");
      if (ctx) {
        ctx.save();
        ctx.globalCompositeOperation = 'destination-out';
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, eraserSize / 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      broadcast({ type: 'erase-point', x: pos.x, y: pos.y, eraserSize });
      onErase?.(pos, eraserSize);
      return;
    }

    if (!isDrawingRef.current) return;
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    currentPointsRef.current = [...currentPointsRef.current, pos];

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

    broadcast({ type: 'draw', x: pos.x, y: pos.y, color: penColor, width: penWidth });
  }, [isTrainer, activeTool, getPos, eraserSize, penColor, penWidth, broadcast, onErase]);

  const stopDrawing = useCallback(() => {
    if (!isTrainer || !isDrawingRef.current) return;
    isDrawingRef.current = false;
    if (currentPointsRef.current.length > 0 && onStrokeEnd) {
      onStrokeEnd(currentPointsRef.current, activeTool, penColor, penWidth);
    }
    currentPointsRef.current = [];
  }, [isTrainer, onStrokeEnd, activeTool, penColor, penWidth]);

  const getCursorStyle = () => !isTrainer ? 'default' : activeTool === 'eraser' ? 'none' : activeTool === 'text' ? 'text' : 'crosshair';

  return (
    <div style={{ width: "100%", height: "100%", position: "relative", display: "flex", flexDirection: "column", background: "#1A1A1A" }}>
      <div style={{ flex: 1, display: "flex", justifyContent: "center", alignItems: "center", overflow: "hidden", position: "relative" }}>
        <canvas
          ref={canvasRef}
          width={CANVAS_WIDTH}
          height={CANVAS_HEIGHT}
          style={{ width: "100%", height: "100%", objectFit: "contain", touchAction: "none", cursor: getCursorStyle() }}
          onMouseDown={startDrawing}
          onMouseMove={(e) => { draw(e); if (activeTool === 'eraser' && isTrainer) setCursorPos(getPos(e)); else if (activeTool !== 'eraser') setCursorPos(null); }}
          onMouseUp={stopDrawing}
          onMouseLeave={() => { stopDrawing(); setCursorPos(null); }}
          onTouchStart={startDrawing}
          onTouchMove={draw}
          onTouchEnd={stopDrawing}
        />
        {isTrainer && activeTool === 'eraser' && cursorPos && (
          <div style={{ position: "absolute", left: `${(cursorPos.x / CANVAS_WIDTH) * 100}%`, top: `${(cursorPos.y / CANVAS_HEIGHT) * 100}%`, transform: 'translate(-50%, -50%)', pointerEvents: "none", zIndex: 20 }}>
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
            onChange={handleTextInput}
            onBlur={handleTextBlur}
            onKeyDown={(e) => { if (e.key === 'Escape') handleTextBlur(); }}
            style={{
              position: "absolute", left: `${(activeTextInput.x / CANVAS_WIDTH) * 100}%`, top: `${(activeTextInput.y / CANVAS_HEIGHT) * 100}%`,
              background: "transparent", border: "2px dashed rgba(255,255,255,0.5)", color: activeTextInput.fontColor,
              fontFamily: activeTextInput.fontFamily, fontSize: `${activeTextInput.fontSize * 0.5}px`,
              fontWeight: activeTextInput.fontWeight as React.CSSProperties["fontWeight"], fontStyle: activeTextInput.fontStyle,
              padding: "4px", resize: "none", outline: "none", minWidth: "100px", minHeight: "30px", zIndex: 30, lineHeight: 1.2,
            }}
          />
        )}
      </div>
    </div>
  );
}