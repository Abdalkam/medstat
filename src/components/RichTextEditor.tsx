import { useRef, useEffect, useState } from "react";

const C = {
  card: "#FFFFFF", separator: "#E5E5EA", medBlue: "#007AFF", textPrimary: "#1C1C1E", textTertiary: "#8E8E93", bg: "#F2F2F7"
};

const IMAGE_MAX_DIMENSION = 1920;
const IMAGE_QUALITY = 0.85;

export default function RichTextEditor({ value, onChange, placeholder, minHeight = "80px" }: { value: string; onChange: (html: string) => void; placeholder?: string; minHeight?: string }) {
  const editorRef = useRef<HTMLDivElement>(null);
  const savedRangeRef = useRef<Range | null>(null);
  const selectedMediaRef = useRef<HTMLElement | null>(null);
  
  const [showControls, setShowControls] = useState(false);
  const [controlMode, setControlMode] = useState<'move' | 'resize'>('move');
  const [mediaPos, setMediaPos] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  
  const dragStartPos = useRef({ x: 0, y: 0 });
  const mediaStartPos = useRef({ x: 0, y: 0 });

  useEffect(() => {
    if (editorRef.current && !editorRef.current.innerHTML && value) {
      editorRef.current.innerHTML = value;
    }
  }, [value]);

  const handleChange = () => {
    if (editorRef.current) onChange(editorRef.current.innerHTML);
  };

  const exec = (command: string, val?: string) => {
    document.execCommand(command, false, val);
    handleChange();
  };

  const saveSelection = () => {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0 && editorRef.current?.contains(sel.anchorNode)) {
      savedRangeRef.current = sel.getRangeAt(0);
    }
  };

  const checkTextSelection = () => {
    const sel = window.getSelection();
    if (sel && sel.toString().length > 0 && editorRef.current?.contains(sel.anchorNode)) {
      setShowControls(true);
    } else if (!selectedMediaRef.current) {
      setShowControls(false);
    }
  };

  const compressImage = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          let { width, height } = img;
          if (width > IMAGE_MAX_DIMENSION || height > IMAGE_MAX_DIMENSION) {
            const ratio = Math.min(IMAGE_MAX_DIMENSION / width, IMAGE_MAX_DIMENSION / height);
            width = Math.round(width * ratio);
            height = Math.round(height * ratio);
          }
          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext("2d");
          if (!ctx) return reject(new Error("Canvas not supported"));
          ctx.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL("image/jpeg", IMAGE_QUALITY));
        };
        img.onerror = () => reject(new Error("Failed to load image"));
        img.src = reader.result as string;
      };
      reader.onerror = () => reject(new Error("Failed to read file"));
      reader.readAsDataURL(file);
    });
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const compressedDataUrl = await compressImage(file);
      if (editorRef.current) {
        editorRef.current.focus();
        const sel = window.getSelection();
        if (sel && savedRangeRef.current) {
          sel.removeAllRanges();
          sel.addRange(savedRangeRef.current);
        }
        document.execCommand('insertImage', false, compressedDataUrl);
        handleChange();
      }
    } catch (error) {
      console.error("Image upload failed:", error);
      alert("Failed to upload image. Please try another one.");
    } finally {
      e.target.value = "";
    }
  };

  const handleVideoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 50 * 1024 * 1024) {
      alert("Video is too large. Please upload a video smaller than 50MB.");
      e.target.value = "";
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (editorRef.current) {
        editorRef.current.focus();
        const sel = window.getSelection();
        if (sel && savedRangeRef.current) {
          sel.removeAllRanges();
          sel.addRange(savedRangeRef.current);
        }
        const videoHtml = `<video src="${reader.result}" controls style="max-width: 100%; height: auto; border-radius: 8px; margin: 8px 0; cursor: pointer; display: inline-block; position: relative;"></video>`;
        document.execCommand('insertHTML', false, videoHtml);
        handleChange();
      }
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const handleEditorClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (selectedMediaRef.current && selectedMediaRef.current !== target) {
      selectedMediaRef.current.style.outline = 'none';
      selectedMediaRef.current = null;
    }
    if (target.tagName === 'IMG' || target.tagName === 'VIDEO') {
      selectedMediaRef.current = target as HTMLElement;
      target.style.outline = `2px solid ${C.medBlue}`;
      setShowControls(true);
      const computed = window.getComputedStyle(target);
      const matrix = new DOMMatrix(computed.transform);
      setMediaPos({ x: matrix.m41, y: matrix.m42 });
    } else {
      checkTextSelection();
    }
  };

  const handleArrow = (direction: 'up' | 'down' | 'left' | 'right') => {
    if (selectedMediaRef.current) {
      const el = selectedMediaRef.current;
      if (controlMode === 'move') {
        const step = 5;
        let newX = mediaPos.x;
        let newY = mediaPos.y;
        if (direction === 'up') newY -= step;
        if (direction === 'down') newY += step;
        if (direction === 'left') newX -= step;
        if (direction === 'right') newX += step;
        setMediaPos({ x: newX, y: newY });
        el.style.transform = `translate(${newX}px, ${newY}px)`;
      } else {
        const step = 10;
        let width = el.offsetWidth;
        let height = el.offsetHeight;
        if (direction === 'right') width += step;
        if (direction === 'left') width = Math.max(20, width - step);
        if (direction === 'up') height += step; 
        if (direction === 'down') height = Math.max(20, height - step);
        el.style.width = `${width}px`;
        el.style.height = `${height}px`;
      }
      el.style.outline = 'none';
      handleChange();
      el.style.outline = `2px solid ${C.medBlue}`;
    } else {
      editorRef.current?.focus();
      const sel = window.getSelection();
      if (sel && savedRangeRef.current && sel.rangeCount === 0) {
        sel.removeAllRanges();
        sel.addRange(savedRangeRef.current);
      }
      if (controlMode === 'move') {
        if (direction === 'left') exec('justifyLeft');
        else if (direction === 'right') exec('justifyRight');
        else if (direction === 'up') exec('justifyCenter');
        else if (direction === 'down') exec('justifyFull');
      } else {
        // Fixed TypeScript Error: Changed null to undefined
        if (direction === 'left' || direction === 'down') document.execCommand('decreaseFontSize', false, undefined);
        else document.execCommand('increaseFontSize', false, undefined);
        handleChange();
      }
    }
  };

  useEffect(() => {
    if (!isDragging) return;
    const handleMouseMove = (e: MouseEvent) => {
      e.preventDefault(); 
      const dx = e.clientX - dragStartPos.current.x;
      const dy = e.clientY - dragStartPos.current.y;
      const newX = mediaStartPos.current.x + dx;
      const newY = mediaStartPos.current.y + dy;
      setMediaPos({ x: newX, y: newY });
      if (selectedMediaRef.current) selectedMediaRef.current.style.transform = `translate(${newX}px, ${newY}px)`;
    };
    const handleMouseUp = () => {
      setIsDragging(false);
      if (selectedMediaRef.current && editorRef.current) {
        selectedMediaRef.current.style.outline = 'none';
        handleChange();
        selectedMediaRef.current.style.outline = `2px solid ${C.medBlue}`;
      }
    };
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDragging]);

  const startDrag = (e: React.MouseEvent) => {
    if (!selectedMediaRef.current) return;
    e.preventDefault();
    e.stopPropagation();
    dragStartPos.current = { x: e.clientX, y: e.clientY };
    mediaStartPos.current = { ...mediaPos };
    setIsDragging(true);
  };

  const btnStyle: React.CSSProperties = {
    background: C.bg, border: `1px solid ${C.separator}`, borderRadius: "4px", 
    cursor: "pointer", padding: "4px 8px", display: "flex", alignItems: "center", 
    justifyContent: "center", color: C.textPrimary, fontSize: "13px", fontWeight: "500"
  };

  const activeBtnStyle: React.CSSProperties = {
    ...btnStyle, background: C.medBlue, color: "#FFFFFF", borderColor: C.medBlue
  };

  return (
    <div style={{ border: `1px solid ${C.separator}`, borderRadius: "8px", overflow: "hidden", background: C.card, flex: 1 }}>
      <div style={{ display: "flex", gap: "4px", padding: "6px", borderBottom: `1px solid ${C.separator}`, flexWrap: "wrap", alignItems: "center" }}>
        <button type="button" style={btnStyle} onMouseDown={(e) => e.preventDefault()} onClick={() => exec('bold')}><b>B</b></button>
        <button type="button" style={btnStyle} onMouseDown={(e) => e.preventDefault()} onClick={() => exec('italic')}><i>I</i></button>
        <button type="button" style={btnStyle} onMouseDown={(e) => e.preventDefault()} onClick={() => exec('underline')}><u>U</u></button>
        
        <div style={{ width: "1px", height: "20px", background: C.separator, margin: "0 4px" }}></div>
        
        <select style={{ ...btnStyle, padding: "4px" }} onChange={(e) => exec('fontSize', e.target.value)} defaultValue="">
          <option value="" disabled>Size</option>
          <option value="2">Small</option>
          <option value="3">Normal</option>
          <option value="5">Large</option>
          <option value="6">X-Large</option>
          <option value="7">XX-Large</option>
        </select>

        <label style={{ ...btnStyle, cursor: "pointer", gap: "4px" }}>
          🎨 Color
          <input type="color" style={{ width: "20px", height: "20px", border: "none", background: "none", cursor: "pointer" }} onChange={(e) => exec('foreColor', e.target.value)} />
        </label>

        <div style={{ width: "1px", height: "20px", background: C.separator, margin: "0 4px" }}></div>

        <label style={{ ...btnStyle, cursor: "pointer" }} onMouseDown={(e) => { e.preventDefault(); saveSelection(); }}>
          🖼️ Image
          <input type="file" accept="image/*" style={{ display: "none" }} onChange={handleImageUpload} />
        </label>

        <label style={{ ...btnStyle, cursor: "pointer" }} onMouseDown={(e) => { e.preventDefault(); saveSelection(); }}>
          🎬 Video
          <input type="file" accept="video/*" style={{ display: "none" }} onChange={handleVideoUpload} />
        </label>

        {showControls && (
          <>
            <div style={{ width: "1px", height: "20px", background: C.separator, margin: "0 4px" }}></div>
            <button type="button" style={controlMode === 'move' ? activeBtnStyle : btnStyle} onMouseDown={(e) => e.preventDefault()} onClick={() => setControlMode('move')}>✥ Move</button>
            <button type="button" style={controlMode === 'resize' ? activeBtnStyle : btnStyle} onMouseDown={(e) => e.preventDefault()} onClick={() => setControlMode('resize')}>⤢ Resize</button>
            <div style={{ width: "1px", height: "20px", background: C.separator, margin: "0 4px" }}></div>
            <button type="button" style={btnStyle} onMouseDown={(e) => e.preventDefault()} onClick={() => handleArrow('left')}>←</button>
            <button type="button" style={btnStyle} onMouseDown={(e) => e.preventDefault()} onClick={() => handleArrow('up')}>↑</button>
            <button type="button" style={btnStyle} onMouseDown={(e) => e.preventDefault()} onClick={() => handleArrow('down')}>↓</button>
            <button type="button" style={btnStyle} onMouseDown={(e) => e.preventDefault()} onClick={() => handleArrow('right')}>→</button>
            {selectedMediaRef.current && <button type="button" style={{ ...btnStyle, cursor: isDragging ? 'grabbing' : 'grab' }} onMouseDown={startDrag}>✥ Drag</button>}
          </>
        )}
      </div>
      
      <div
        ref={editorRef}
        contentEditable
        onClick={handleEditorClick}
        onMouseUp={checkTextSelection}
        onKeyUp={checkTextSelection}
        onInput={handleChange}
        style={{ padding: "12px", minHeight, outline: "none", fontSize: "15px", color: C.textPrimary, lineHeight: "1.5", overflowY: "auto" }}
        data-placeholder={placeholder}
      />
      
      <style>{`
        [contenteditable][data-placeholder]:empty:before { content: attr(data-placeholder); color: ${C.textTertiary}; pointer-events: none; display: block; }
        [contenteditable] img, [contenteditable] video { max-width: 100%; height: auto; border-radius: 8px; margin: 8px 0; cursor: pointer; display: inline-block; transition: outline 0.1s; position: relative; }
      `}</style>
    </div>
  );
}