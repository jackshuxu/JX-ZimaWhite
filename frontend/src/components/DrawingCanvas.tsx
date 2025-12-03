"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";

type Props = {
  width?: number;
  height?: number;
  onChange?: (input: number[]) => void;
  onCanvasImage?: (dataUrl: string | null) => void;
};

const DEFAULT_SIZE = 320;

export function DrawingCanvas({
  width = DEFAULT_SIZE,
  height = DEFAULT_SIZE,
  onChange,
  onCanvasImage,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const smallRef = useRef<HTMLCanvasElement | null>(null);
  const [mode, setMode] = useState<"pen" | "erase">("pen");
  const drawing = useRef(false);

  const emitInput = useCallback(() => {
    const canvas = canvasRef.current;
    const small = smallRef.current;
    if (!canvas || !small) return;

    const smallCtx = small.getContext("2d");
    if (!smallCtx) return;

    // Downsample to 28x28
    smallCtx.drawImage(
      canvas,
      0,
      0,
      canvas.width,
      canvas.height,
      0,
      0,
      small.width,
      small.height
    );

    // Extract grayscale values (0-1)
    const imageData = smallCtx.getImageData(0, 0, 28, 28).data;
    const arr: number[] = [];
    for (let i = 0; i < imageData.length; i += 4) {
      arr.push(imageData[i] / 255);
    }
    onChange?.(arr);
    onCanvasImage?.(canvas.toDataURL("image/png"));
  }, [onCanvasImage, onChange]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "black";
    ctx.fillRect(0, 0, width, height);

    // Create offscreen canvas for downsampling
    const smallCanvas = document.createElement("canvas");
    smallCanvas.width = 28;
    smallCanvas.height = 28;
    smallRef.current = smallCanvas;
    emitInput();
  }, [emitInput, height, width]);

  const pointerDown = () => {
    drawing.current = true;
  };

  const pointerUp = () => {
    drawing.current = false;
    emitInput();
  };

  const pointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * canvas.width;
    const y = ((event.clientY - rect.top) / rect.height) * canvas.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = mode === "pen" ? "#ffffff" : "#000000";
    ctx.beginPath();
    ctx.arc(x, y, 12, 0, Math.PI * 2);
    ctx.fill();
    emitInput();
  };

  const clearCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    emitInput();
    onCanvasImage?.(null);
  }, [emitInput, onCanvasImage]);

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        {(["pen", "erase"] as const).map((tool) => (
          <button
            key={tool}
            onClick={() => setMode(tool)}
            className={`border px-3 py-1 text-xs uppercase tracking-widest transition-colors ${
              mode === tool
                ? "border-white bg-white text-black"
                : "border-white/40 text-white hover:border-white"
            }`}
          >
            {tool === "pen" ? "DRAW" : "ERASE"}
          </button>
        ))}
        <button
          onClick={clearCanvas}
          className="border border-red-500/60 px-3 py-1 text-xs uppercase tracking-widest text-red-300 transition-colors hover:bg-red-500 hover:text-black"
        >
          CLEAR
        </button>
      </div>
      <canvas
        ref={canvasRef}
        className="border border-white/20 bg-black shadow-[0_0_60px_rgba(255,255,255,0.05)]"
        style={{ width, height, touchAction: "none" }}
        onPointerDown={pointerDown}
        onPointerUp={pointerUp}
        onPointerLeave={pointerUp}
        onPointerMove={pointerMove}
      />
    </div>
  );
}
