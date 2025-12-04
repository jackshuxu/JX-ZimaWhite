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
const EMIT_THROTTLE_MS = 50; // Throttle emissions to prevent render loop

export function DrawingCanvas({
  width = DEFAULT_SIZE,
  height = DEFAULT_SIZE,
  onChange,
  onCanvasImage,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const smallRef = useRef<HTMLCanvasElement | null>(null);
  const smallCtxRef = useRef<CanvasRenderingContext2D | null>(null);
  const [mode, setMode] = useState<"pen" | "erase">("pen");
  const drawing = useRef(false);
  const lastEmitRef = useRef(0);
  const pendingEmitRef = useRef<number | null>(null);

  // Store callbacks in refs to avoid dependency issues
  const onChangeRef = useRef(onChange);
  const onCanvasImageRef = useRef(onCanvasImage);
  useEffect(() => {
    onChangeRef.current = onChange;
    onCanvasImageRef.current = onCanvasImage;
  }, [onChange, onCanvasImage]);

  const emitInput = useCallback(() => {
    const canvas = canvasRef.current;
    const small = smallRef.current;
    if (!canvas || !small) return;

    const now = Date.now();
    const timeSinceLastEmit = now - lastEmitRef.current;

    // If we emitted recently, schedule a delayed emit instead
    if (timeSinceLastEmit < EMIT_THROTTLE_MS) {
      if (pendingEmitRef.current === null) {
        pendingEmitRef.current = window.setTimeout(() => {
          pendingEmitRef.current = null;
          emitInputImmediate();
        }, EMIT_THROTTLE_MS - timeSinceLastEmit);
      }
      return;
    }

    emitInputImmediate();
  }, []);

  const emitInputImmediate = useCallback(() => {
    const canvas = canvasRef.current;
    const small = smallRef.current;
    const smallCtx = smallCtxRef.current;
    if (!canvas || !small || !smallCtx) return;

    lastEmitRef.current = Date.now();

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
    onChangeRef.current?.(arr);
    onCanvasImageRef.current?.(canvas.toDataURL("image/png"));
  }, []);

  // Initialize canvas once on mount (or when size changes)
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
    // Use willReadFrequently for better getImageData performance
    smallCtxRef.current = smallCanvas.getContext("2d", {
      willReadFrequently: true,
    });

    // Emit initial empty state after a frame
    const rafId = requestAnimationFrame(() => {
      emitInputImmediate();
    });

    return () => {
      cancelAnimationFrame(rafId);
      if (pendingEmitRef.current !== null) {
        clearTimeout(pendingEmitRef.current);
        pendingEmitRef.current = null;
      }
    };
  }, [height, width, emitInputImmediate]);

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
    emitInputImmediate();
    onCanvasImageRef.current?.(null);
  }, [emitInputImmediate]);

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
