/* ============================================================================
 * src/components/DrawingBlackboard.tsx  (canvas edition)
 * Shared chalkboard for the live classroom. Drawn with <canvas> (1280×720
 * bitmap) so trainer and learners see an identical picture.
 *
 * INPUT — one code path for EVERY pointer:
 *   Pointer Events (pointerdown/move/up/cancel) unify mouse, finger and
 *   pen/stylus (Apple Pencil, Wacom…). touch-action:none stops the browser
 *   from scrolling/zooming while you draw, setPointerCapture keeps the stroke
 *   alive if the finger slides off the canvas, and non-primary pointers are
 *   ignored (basic palm rejection when you rest your hand on a tablet).
 *
 * TOOLS
 *   pen    — freehand ink; taps leave dots; strokes persist to
 *            live_presentations.blackboard_strokes via onStrokeEnd.
 *   eraser — destination-out circles; the eraser stroke is ALSO reported via
 *            onStrokeEnd (tool="eraser") so erasures survive canvas redraws
 *            and reloads on every device.
 *   text   — name parts of the drawing: tap/tap-and-drag. Tap an empty spot
 *            to place a label and type with the keyboard (Enter commits,
 *            Shift+Enter = newline, Esc cancels). Tap an existing label to
 *            edit it; DRAG it to move it. Commits go through onTextAdd
 *            (upsert by id) / onTextDelete into blackboard_labels.
 *
 * SYNC — trainer broadcasts pen/eraser/text events on the Supabase Realtime
 * channel `whiteboard-${courseId}` for zero-latency learner preview, while
 * the strokes/texts/lines props (from live_presentations) remain the
 * authoritative state that is replayed on every redraw. Both screens MUST
 * pass the SAME courseId or learners will not join the trainer's channel.
 *
 * COORDINATES — all stored points/labels are pixels of the 1280×720 bitmap.
 * getPos() maps client coordinates through the letterboxed bitmap rect
 * (object-fit: contain), so ink lands exactly under the finger/mouse on any
 * screen shape — the previous version ignored letterboxing and drew offset.
 * ========================================================================== */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  CSSProperties,
  PointerEvent as ReactPointerEvent,
  ChangeEvent,
  KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { supabase } from "../auth/supabase";

const CANVAS_WIDTH = 1280;
const CANVAS_HEIGHT = 720;
const MAX_VISIBLE_LINES = 6;

// ==================== SHARED TYPES ====================
export interface Point { x: number; y: number; }
/* tool: "line" is accepted for backwards compatibility with rows written by
 * the earlier SVG blackboard (rendered as a straight segment). */
export interface Stroke { id: string; points: Point[]; color?: string; width?: number; tool?: "pen" | "eraser" | "text" | "line"; }
export interface TextItem { id: string; x: number; y: number; text: string; fontFamily: string; fontSize: number; fontColor: string; fontWeight: string; fontStyle: string; }
export type ToolType = "pen" | "eraser" | "text";
export interface FontOptions { fontFamily: string; fontSize: number; fontColor: string; fontWeight: string; fontStyle: string; }

export const FONT_FAMILIES = ["Arial", "Times New Roman", "Courier New", "Georgia", "Verdana", "Comic Sans MS", "Impact", "Trebuchet MS"];

interface DrawPayload {
  type: "start" | "draw" | "stop" | "clear" | "erase-point" | "text-add";
  x: number;
  y: number;
  color?: string;
  width?: number;
  eraserSize?: number;
  textItem?: TextItem;
}

// ==================== CANVAS PRIMITIVES ====================
function drawSegment(ctx: CanvasRenderingContext2D, from: Point, to: Point, color: string, width: number) {
  ctx.save();
  ctx.globalCompositeOperation = "source-over";
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
  ctx.restore();
}

function drawDot(ctx: CanvasRenderingContext2D, pos: Point, color: string, radius: number) {
  ctx.save();
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(pos.x, pos.y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function eraseCircle(ctx: CanvasRenderingContext2D, pos: Point, radius: number) {
  ctx.save();
  ctx.globalCompositeOperation = "destination-out";
  ctx.beginPath();
  ctx.arc(pos.x, pos.y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawTextItem(ctx: CanvasRenderingContext2D, t: TextItem) {
  ctx.save();
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = t.fontColor || "#FFFFFF";
  ctx.font = `${t.fontStyle || "normal"} ${t.fontWeight || "normal"} ${t.fontSize || 24}px ${t.fontFamily || "Arial"}`;
  ctx.textBaseline = "top";
  const size = t.fontSize || 24;
  String(t.text).split("\n").forEach((line, i) => ctx.fillText(line, t.x, t.y + i * size * 1.2));
  ctx.restore();
}

// ==================== COMPONENT ====================
interface DrawingBlackboardProps {
  isTrainer: boolean;
  strokes: Stroke[];
  /** Named labels ("text" tool) — live_presentations.blackboard_labels. */
  texts?: TextItem[];
  /** Trainer's "Send to board" lines — live_presentations.blackboard_lines. */
  lines?: string[];
  onStrokeEnd?: (points: Point[], tool: ToolType, color?: string, width?: number) => void;
  onErase?: (pos: Point, radius: number) => void;
  /** UPSERT by id — called when a label is created, edited or drag-moved. */
  onTextAdd?: (text: TextItem) => void;
  /** Called when an existing label is emptied (deletion). */
  onTextDelete?: (id: string) => void;
  activeTool?: ToolType;
  fontSize?: number;
  fontFamily?: string;
  fontColor?: string;
  fontWeight?: string;
  fontStyle?: string;
  penColor?: string;
  penWidth?: number;
  eraserSize?: number;
  /** MUST be identical on trainer and learner screens (channel name). */
  courseId: string;
}

export default function DrawingBlackboard({
  isTrainer,
  strokes,
  texts = [],
  lines = [],
  onStrokeEnd,
  onErase,
  onTextAdd,
  onTextDelete,
  activeTool = "pen",
  fontSize = 24,
  fontFamily = "Arial",
  fontColor = "#FFFFFF",
  fontWeight = "normal",
  fontStyle = "normal",
  penColor = "#FFFFFF",
  penWidth = 4,
  eraserSize = 30,
  courseId,
}: DrawingBlackboardProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const isDrawingRef = useRef(false);
  const currentPointsRef = useRef<Point[]>([]);
  const lastErasePosRef = useRef<Point>({ x: 0, y: 0 });
  const lastSegRef = useRef<Point | null>(null); // learner: last broadcast segment end
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const dragRef = useRef<{ item: TextItem; startX: number; startY: number; moved: boolean } | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  const [activeTextInput, setActiveTextInput] = useState<TextItem | null>(null);
  const activeTextInputRef = useRef<TextItem | null>(null);
  const [dragText, setDragText] = useState<TextItem | null>(null);
  const [cursorPos, setCursorPos] = useState<Point | null>(null);

  // Legacy rows written by the previous blackboard may miss id/font fields
  // (they were { text, x, y } objects) — normalise once so every consumer
  // sees a complete TextItem and old labels stay visible/editable.
  const normTexts = useMemo<TextItem[]>(
    () => (texts || []).map((t, i) => ({
      id: t.id || `label-${i}`,
      x: Number(t.x) || 0,
      y: Number(t.y) || 0,
      text: t.text || "",
      fontFamily: t.fontFamily || "Arial",
      fontSize: Number(t.fontSize) || 24,
      fontColor: t.fontColor || "#FFFFFF",
      fontWeight: t.fontWeight || "normal",
      fontStyle: t.fontStyle || "normal",
    })),
    [texts]
  );

  // Latest-value mirrors so pointer handlers never read stale props/state.
  const textsRef = useRef(normTexts);
  textsRef.current = normTexts;
  const activeToolRef = useRef(activeTool);
  activeToolRef.current = activeTool;
  const penOpts = useRef({ penColor, penWidth, eraserSize });
  penOpts.current = { penColor, penWidth, eraserSize };

  /* ---------------- geometry: client px -> 1280×720 bitmap px ---------------- */
  const bitmapRect = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const scale = Math.min(rect.width / CANVAS_WIDTH, rect.height / CANVAS_HEIGHT) || 1;
    const offsetX = (rect.width - CANVAS_WIDTH * scale) / 2;
    const offsetY = (rect.height - CANVAS_HEIGHT * scale) / 2;
    return { rect, scale, offsetX, offsetY };
  }, []);

  const getPos = useCallback((e: ReactPointerEvent): Point => {
    const br = bitmapRect();
    if (!br) return { x: 0, y: 0 };
    const x = (e.clientX - br.rect.left - br.offsetX) / br.scale;
    const y = (e.clientY - br.rect.top - br.offsetY) / br.scale;
    return {
      x: Math.max(0, Math.min(CANVAS_WIDTH, x)),
      y: Math.max(0, Math.min(CANVAS_HEIGHT, y)),
    };
  }, [bitmapRect]);

  /** Percentage position of a bitmap point inside the wrapper (overlays). */
  const overlayPct = useCallback((p: Point) => {
    const br = bitmapRect();
    if (!br) return { left: "50%", top: "50%", scale: 1 };
    return {
      left: `${((br.offsetX + p.x * br.scale) / br.rect.width) * 100}%`,
      top: `${((br.offsetY + p.y * br.scale) / br.rect.height) * 100}%`,
      scale: br.scale,
    };
  }, [bitmapRect]);

  /* ---------------- realtime channel ---------------- */
  const broadcast = useCallback((payload: DrawPayload) => {
    if (isTrainer && channelRef.current) {
      channelRef.current.send({ type: "broadcast", event: "draw-event", payload });
    }
  }, [isTrainer]);

  useEffect(() => {
    if (!courseId) return;
    const channel = supabase.channel(`whiteboard-${courseId}`);
    channelRef.current = channel;

    if (!isTrainer) {
      // Learner: apply the trainer's live events instantly. Segment-based
      // drawing (each event draws last->current) so accumulated canvas paths
      // can never be lost to a redraw in between events.
      channel.on("broadcast", { event: "draw-event" }, ({ payload }) => {
        const d = payload as DrawPayload;
        const ctx = canvasRef.current?.getContext("2d");
        if (!ctx) return;
        if (d.type === "start") {
          lastSegRef.current = { x: d.x, y: d.y };
          drawDot(ctx, { x: d.x, y: d.y }, d.color || "#FFFFFF", (d.width || 4) / 2);
        } else if (d.type === "draw") {
          const from = lastSegRef.current || { x: d.x, y: d.y };
          drawSegment(ctx, from, { x: d.x, y: d.y }, d.color || "#FFFFFF", d.width || 4);
          lastSegRef.current = { x: d.x, y: d.y };
        } else if (d.type === "erase-point") {
          eraseCircle(ctx, { x: d.x, y: d.y }, (d.eraserSize || 30) / 2);
        } else if (d.type === "clear") {
          ctx.globalCompositeOperation = "source-over";
          ctx.fillStyle = "#1A1A1A";
          ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
        } else if (d.type === "text-add" && d.textItem) {
          drawTextItem(ctx, d.textItem);
        }
      });
    }
    channel.subscribe();

    return () => {
      supabase.removeChannel(channel);
      if (channelRef.current === channel) channelRef.current = null;
    };
  }, [courseId, isTrainer]);

  /* ---------------- authoritative redraw (strokes + texts + lines) ---------------- */
  useEffect(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "#1A1A1A";
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    (strokes || []).forEach((s) => {
      const pts = s.points || [];
      if (!pts.length) return;
      if (s.tool === "eraser") {
        // Replay stored eraser strokes as destination-out circles — erasures
        // now survive redraws/reloads instead of fading back in.
        const r = (s.width || eraserSize) / 2;
        pts.forEach((p) => eraseCircle(ctx, p, r));
        return;
      }
      const color = s.color || "#FFFFFF";
      const width = s.width || penWidth;
      if (s.tool === "line" && pts.length >= 2) {
        drawSegment(ctx, pts[0], pts[pts.length - 1], color, width);
      } else if (pts.length === 1) {
        drawDot(ctx, pts[0], color, width / 2);
      } else {
        for (let i = 1; i < pts.length; i++) drawSegment(ctx, pts[i - 1], pts[i], color, width);
      }
    });

    normTexts.forEach((t) => {
      if (!t.text) return;
      if (dragText && t.id === dragText.id) return; // the dragged copy renders below
      drawTextItem(ctx, t);
    });
    if (dragText) drawTextItem(ctx, dragText);

    (lines || []).slice(-MAX_VISIBLE_LINES).forEach((line, i) => {
      const shown = (lines || []).slice(-MAX_VISIBLE_LINES);
      const lh = Math.min(fontSize, 24) * 1.35;
      ctx.save();
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = "rgba(255,255,255,0.95)";
      ctx.font = `normal 600 ${Math.min(fontSize, 24)}px ${fontFamily || "Arial"}`;
      ctx.textBaseline = "alphabetic";
      ctx.shadowColor = "rgba(0,0,0,0.5)";
      ctx.shadowBlur = 4;
      ctx.fillText(line, 18, CANVAS_HEIGHT - 14 - (shown.length - 1 - i) * lh);
      ctx.restore();
    });
  }, [strokes, normTexts, lines, dragText, eraserSize, penWidth, fontSize, fontFamily]);

  /* ---------------- text helpers ---------------- */
  const hitTestText = useCallback((pos: Point): TextItem | null => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return null;
    for (let i = textsRef.current.length - 1; i >= 0; i--) {
      const t = textsRef.current[i];
      if (!t.text) continue;
      ctx.save();
      ctx.font = `${t.fontStyle || "normal"} ${t.fontWeight || "normal"} ${t.fontSize || 24}px ${t.fontFamily || "Arial"}`;
      const size = t.fontSize || 24;
      const textLines = String(t.text).split("\n");
      const w = Math.max(...textLines.map((l) => ctx.measureText(l).width));
      ctx.restore();
      const h = textLines.length * size * 1.2;
      if (pos.x >= t.x - 10 && pos.x <= t.x + w + 18 && pos.y >= t.y - 8 && pos.y <= t.y + h + 10) return t;
    }
    return null;
  }, []);

  const commitText = useCallback(() => {
    const item = activeTextInputRef.current;
    if (!item) return;
    activeTextInputRef.current = null;
    setActiveTextInput(null);
    if (!item.text.trim()) {
      // Emptied an existing label -> delete it; new empty label -> discard.
      if (textsRef.current.some((t) => t.id === item.id)) onTextDelete?.(item.id);
      return;
    }
    onTextAdd?.(item);
    broadcast({ type: "text-add", x: 0, y: 0, textItem: item });
  }, [broadcast, onTextAdd, onTextDelete]);

  const cancelText = useCallback(() => {
    activeTextInputRef.current = null;
    setActiveTextInput(null);
  }, []);

  useEffect(() => {
    if (activeTextInput) inputRef.current?.focus();
  }, [activeTextInput]);

  /* ---------------- unified pointer input (mouse + finger + pen) ---------------- */
  const eraseAt = useCallback((pos: Point) => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const radius = penOpts.current.eraserSize;
    eraseCircle(ctx, pos, radius / 2);
    broadcast({ type: "erase-point", x: pos.x, y: pos.y, eraserSize: radius });
    onErase?.(pos, radius);
  }, [broadcast, onErase]);

  const handlePointerDown = useCallback((e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!isTrainer || !e.isPrimary) return;
    // Editor open: let the click blur the textarea (commits/cancels) and do
    // nothing else — the next tap draws or places.
    if (activeTextInputRef.current) return;
    e.preventDefault();
    const pos = getPos(e);
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* older Safari */ }

    if (activeToolRef.current === "text") {
      const hit = hitTestText(pos);
      if (hit) dragRef.current = { item: { ...hit }, startX: pos.x, startY: pos.y, moved: false };
      else {
        const item: TextItem = { id: `text-${Date.now()}`, x: pos.x, y: pos.y, text: "", fontFamily, fontSize, fontColor, fontWeight, fontStyle };
        activeTextInputRef.current = item;
        setActiveTextInput(item);
      }
      return;
    }

    if (activeToolRef.current === "eraser") {
      isDrawingRef.current = true;
      currentPointsRef.current = [pos];
      lastErasePosRef.current = pos;
      setCursorPos(pos);
      eraseAt(pos);
      return;
    }

    // pen
    isDrawingRef.current = true;
    currentPointsRef.current = [pos];
    const ctx = canvasRef.current?.getContext("2d");
    if (ctx) drawDot(ctx, pos, penOpts.current.penColor, penOpts.current.penWidth / 2);
    broadcast({ type: "start", x: pos.x, y: pos.y, color: penOpts.current.penColor, width: penOpts.current.penWidth });
  }, [isTrainer, getPos, hitTestText, fontFamily, fontSize, fontColor, fontWeight, fontStyle, eraseAt, broadcast]);

  const handlePointerMove = useCallback((e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!isTrainer) return;
    const pos = getPos(e);
    if (activeToolRef.current === "eraser") setCursorPos(pos);
    else setCursorPos(null);
    if (!e.isPrimary) return;

    // Dragging an existing label with the text tool.
    const drag = dragRef.current;
    if (activeToolRef.current === "text" && drag) {
      if (Math.hypot(pos.x - drag.startX, pos.y - drag.startY) > 8 || drag.moved) {
        drag.moved = true;
        const item = { ...drag.item, x: drag.item.x + (pos.x - drag.startX), y: drag.item.y + (pos.y - drag.startY) };
        drag.item = item;
        setDragText(item);
      }
      return;
    }
    if (!isDrawingRef.current) return;

    if (activeToolRef.current === "eraser") {
      if (Math.hypot(pos.x - lastErasePosRef.current.x, pos.y - lastErasePosRef.current.y) < 3) return;
      lastErasePosRef.current = pos;
      currentPointsRef.current.push(pos);
      eraseAt(pos);
      return;
    }

    // pen — segment from the previous point (independent of canvas path state)
    const pts = currentPointsRef.current;
    const from = pts[pts.length - 1] || pos;
    pts.push(pos);
    const ctx = canvasRef.current?.getContext("2d");
    if (ctx) drawSegment(ctx, from, pos, penOpts.current.penColor, penOpts.current.penWidth);
    broadcast({ type: "draw", x: pos.x, y: pos.y, color: penOpts.current.penColor, width: penOpts.current.penWidth });
  }, [isTrainer, getPos, eraseAt, broadcast]);

  const finalizeStroke = useCallback(() => {
    if (!isDrawingRef.current) {
      // Text-tool drag release: commit the move, or a simple tap opens the editor.
      const drag = dragRef.current;
      dragRef.current = null;
      if (drag) {
        setDragText(null);
        if (drag.moved) {
          onTextAdd?.(drag.item);
          broadcast({ type: "text-add", x: 0, y: 0, textItem: drag.item });
        } else {
          activeTextInputRef.current = { ...drag.item };
          setActiveTextInput({ ...drag.item });
        }
      }
      return;
    }
    isDrawingRef.current = false;
    const pts = currentPointsRef.current;
    currentPointsRef.current = [];
    if (!pts.length) return;
    if (activeToolRef.current === "eraser") onStrokeEnd?.(pts, "eraser", undefined, penOpts.current.eraserSize);
    else onStrokeEnd?.(pts, "pen", penOpts.current.penColor, penOpts.current.penWidth);
  }, [broadcast, onStrokeEnd, onTextAdd]);

  const handlePointerUp = useCallback(() => { if (isTrainer) finalizeStroke(); }, [isTrainer, finalizeStroke]);
  const handlePointerLeave = useCallback(() => { if (isTrainer) { finalizeStroke(); setCursorPos(null); } }, [isTrainer, finalizeStroke]);

  /* ---------------- keyboard-friendly text editing ---------------- */
  const handleTextInput = useCallback((e: ChangeEvent<HTMLTextAreaElement>) => {
    setActiveTextInput((prev) => (prev ? { ...prev, text: e.target.value } : prev));
    const cur = activeTextInputRef.current;
    if (cur) activeTextInputRef.current = { ...cur, text: e.target.value };
  }, []);

  const cursorStyle: CSSProperties["cursor"] =
    !isTrainer ? "default" : activeTool === "eraser" ? "none" : activeTool === "text" ? "text" : "crosshair";

  const cursorOverlay = isTrainer && activeTool === "eraser" && cursorPos ? overlayPct(cursorPos) : null;
  const editorOverlay = isTrainer && activeTextInput ? overlayPct(activeTextInput) : null;

  return (
    <div style={{ width: "100%", height: "100%", position: "relative", display: "flex", flexDirection: "column", background: "#1A1A1A", overflow: "hidden", userSelect: "none", WebkitUserSelect: "none", WebkitTouchCallout: "none" }}>
      <div style={{ flex: 1, display: "flex", justifyContent: "center", alignItems: "center", overflow: "hidden", position: "relative" }}>
        <canvas
          ref={canvasRef}
          width={CANVAS_WIDTH}
          height={CANVAS_HEIGHT}
          style={{ width: "100%", height: "100%", objectFit: "contain", touchAction: "none", cursor: cursorStyle }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onPointerLeave={handlePointerLeave}
        />
        {cursorOverlay && (
          <div style={{ position: "absolute", left: cursorOverlay.left, top: cursorOverlay.top, transform: "translate(-50%, -50%)", pointerEvents: "none", zIndex: 20 }}>
            <svg width={(eraserSize + 10) * cursorOverlay.scale} height={(eraserSize + 20) * cursorOverlay.scale} viewBox="0 0 60 70" fill="none">
              <rect x="10" y="5" width="40" height="35" rx="3" fill="#FFD700" stroke="#DAA520" strokeWidth="2" />
              <rect x="15" y="8" width="30" height="10" rx="1" fill="#FFE44D" />
              <rect x="8" y="35" width="44" height="15" rx="2" fill="#FF6B6B" stroke="#E05555" strokeWidth="1.5" />
              <line x1="15" y1="38" x2="15" y2="47" stroke="#E05555" strokeWidth="1" />
              <line x1="25" y1="38" x2="25" y2="47" stroke="#E05555" strokeWidth="1" />
              <line x1="35" y1="38" x2="35" y2="47" stroke="#E05555" strokeWidth="1" />
              <line x1="45" y1="38" x2="45" y2="47" stroke="#E05555" strokeWidth="1" />
              <rect x="22" y="50" width="16" height="18" rx="3" fill="#8B4513" stroke="#6B3410" strokeWidth="1.5" />
            </svg>
            <div style={{ position: "absolute", bottom: -10, left: "50%", transform: "translateX(-50%)", width: eraserSize * cursorOverlay.scale, height: eraserSize * cursorOverlay.scale, borderRadius: "50%", border: "2px dashed rgba(255,255,255,0.4)" }} />
          </div>
        )}
        {editorOverlay && activeTextInput && (
          <textarea
            ref={inputRef}
            value={activeTextInput.text}
            onChange={handleTextInput}
            onBlur={commitText}
            onKeyDown={(e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); commitText(); }
              else if (e.key === "Escape") { e.preventDefault(); cancelText(); }
            }}
            placeholder="Name this part…"
            style={{
              position: "absolute", left: editorOverlay.left, top: editorOverlay.top,
              background: "rgba(0,0,0,0.35)", border: "2px dashed rgba(255,255,255,0.5)", borderRadius: 6,
              color: activeTextInput.fontColor,
              fontFamily: activeTextInput.fontFamily,
              fontSize: `${Math.max(10, activeTextInput.fontSize * editorOverlay.scale)}px`,
              fontWeight: activeTextInput.fontWeight as CSSProperties["fontWeight"],
              fontStyle: activeTextInput.fontStyle,
              padding: "2px 4px", resize: "none", outline: "none",
              minWidth: 120, maxWidth: 320, minHeight: 30, zIndex: 30, lineHeight: 1.2, overflow: "hidden",
            }}
          />
        )}
      </div>
    </div>
  );
}
