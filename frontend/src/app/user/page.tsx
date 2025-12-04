"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { DrawingCanvas } from "@/components/DrawingCanvas";
import { OutputVisualization } from "@/components/OutputVisualization";
import { useNetwork } from "@/hooks/useNetwork";
import { getSocket } from "@/lib/socket";
import { INSTRUMENTS, type Instrument, type CrowdError } from "@/types/network";

export default function UserPage() {
  const router = useRouter();
  const [inputArr, setInputArr] = useState<number[]>(Array(784).fill(0));
  const [canvasData, setCanvasData] = useState<string | null>(null);
  const { activations } = useNetwork(inputArr);

  const [username, setUsername] = useState("");
  const [instrument, setInstrument] = useState<Instrument>("pad");
  const [octave, setOctave] = useState(0); // -2 to +2 range
  const [connected, setConnected] = useState(false);
  const [lastTrigger, setLastTrigger] = useState<number | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [drawMode, setDrawMode] = useState<"pen" | "erase">("pen");
  const [triggerFlash, setTriggerFlash] = useState(false);
  const [orchestraFull, setOrchestraFull] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement & { clearCanvas?: () => void }>(
    null
  );

  // Check for nickname from auth page on mount
  useEffect(() => {
    const storedNickname = localStorage.getItem("mnist_nickname");
    if (!storedNickname) {
      // Redirect to auth page if no nickname
      router.push("/user/auth");
      return;
    }
    setUsername(storedNickname);
    setIsReady(true);
  }, [router]);

  const lastCanvasEmitRef = useRef(0);
  const pendingUpdateRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const socket = useMemo(() => getSocket(), []);

  // Join crowd room on mount
  useEffect(() => {
    socket.emit("crowd:join", {
      role: "participant",
      username: username || "anonymous",
      instrument,
    });

    socket.on("crowd:joined", () => {
      setConnected(true);
      setOrchestraFull(false);
      setErrorMessage(null);
    });

    socket.on("crowd:error", (data: CrowdError) => {
      if (data.code === "ORCHESTRA_FULL") {
        setOrchestraFull(true);
        setErrorMessage(data.message);
        setConnected(false);
      } else {
        setErrorMessage(data.message);
      }
    });

    socket.on("connect", () => {
      socket.emit("crowd:join", {
        role: "participant",
        username: username || "anonymous",
        instrument,
      });
    });

    socket.on("chord:played", (data: { socketId: string }) => {
      if (data.socketId === socket.id) {
        setLastTrigger(Date.now());
      }
    });

    return () => {
      socket.off("crowd:joined");
      socket.off("crowd:error");
      socket.off("connect");
      socket.off("chord:played");
    };
  }, [socket, username, instrument]);

  // Send canvas updates (throttled with pending retry)
  useEffect(() => {
    if (!activations || !connected) return;

    const sendUpdate = () => {
      lastCanvasEmitRef.current = Date.now();
      socket.emit("canvas:update", {
        canvas: canvasData,
        output: activations.output,
        instrument,
      });
    };

    const now = Date.now();
    const timeSinceLast = now - lastCanvasEmitRef.current;

    // Clear any pending update
    if (pendingUpdateRef.current) {
      clearTimeout(pendingUpdateRef.current);
      pendingUpdateRef.current = null;
    }

    if (timeSinceLast >= 200) {
      // Enough time passed, send immediately
      sendUpdate();
    } else {
      // Schedule update after throttle period
      pendingUpdateRef.current = setTimeout(sendUpdate, 200 - timeSinceLast);
    }

    return () => {
      if (pendingUpdateRef.current) {
        clearTimeout(pendingUpdateRef.current);
      }
    };
  }, [activations, canvasData, connected, instrument, socket]);

  // Handle chord trigger
  const handleTrigger = useCallback(() => {
    if (!activations || triggerFlash) return;
    socket.emit("chord:trigger", {
      output: activations.output,
      instrument,
      octave,
    });
    setTriggerFlash(true);
    setTimeout(() => setTriggerFlash(false), 150);
  }, [activations, instrument, octave, socket, triggerFlash]);

  // Handle canvas clear
  const handleClear = useCallback(() => {
    // State updates trigger the throttled canvas update effect
  }, []);

  // Flash feedback on trigger (unused but kept for potential future use)
  const isRecentTrigger = lastTrigger && Date.now() - lastTrigger < 500;

  // Show loading state while checking auth
  if (!isReady) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-black text-white">
        <div className="text-xs uppercase tracking-[0.5em] text-gray-500 animate-pulse">
          Loading...
        </div>
      </main>
    );
  }

  // Show orchestra full state
  if (orchestraFull) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-black text-white gap-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold uppercase tracking-widest text-red-400 mb-2">
            Orchestra Full
          </h1>
          <p className="text-sm uppercase tracking-widest text-gray-500 max-w-xs">
            {errorMessage ||
              "The orchestra has reached its maximum capacity. Please try again later."}
          </p>
        </div>
        <button
          onClick={() => {
            setOrchestraFull(false);
            setErrorMessage(null);
            socket.emit("crowd:join", {
              role: "participant",
              username: username || "anonymous",
              instrument,
            });
          }}
          className="border border-white/30 px-6 py-3 text-xs uppercase tracking-widest text-white transition-colors hover:border-white hover:bg-white/10"
        >
          Try Again
        </button>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-black text-white flex flex-col items-center">
      <div className="flex flex-col items-center gap-4 px-4 py-4">
        {/* Header */}
        <header className="text-center">
          <p className="text-xs uppercase tracking-[0.5em] text-gray-500">
            MNIST ORCHESTRA
          </p>
          <h1 className="mt-1 text-xl font-bold uppercase tracking-widest">
            {username}
          </h1>
        </header>

        {/* Instrument picker */}
        <div className="space-y-2">
          <label className="text-xs uppercase tracking-widest text-gray-500">
            Instrument
          </label>
          <div className="flex flex-wrap gap-2">
            {INSTRUMENTS.map((inst) => (
              <button
                key={inst}
                onClick={() => setInstrument(inst)}
                className={`border px-4 py-2 text-xs uppercase tracking-widest transition-colors ${
                  instrument === inst
                    ? "border-white bg-white text-black"
                    : "border-white/30 text-gray-300 hover:border-white"
                }`}
              >
                {inst}
              </button>
            ))}
          </div>
        </div>

        {/* Octave control */}
        <div className="space-y-2">
          <label className="text-xs uppercase tracking-widest text-gray-500">
            Octave
          </label>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setOctave((o) => Math.max(-2, o - 1))}
              disabled={octave <= -2}
              className={`border px-4 py-2 text-sm font-bold transition-colors ${
                octave <= -2
                  ? "border-white/10 text-gray-600 cursor-not-allowed"
                  : "border-white/30 text-white hover:border-white hover:bg-white/10"
              }`}
            >
              −
            </button>
            <span className="w-12 text-center text-lg font-mono">
              {octave > 0 ? `+${octave}` : octave}
            </span>
            <button
              onClick={() => setOctave((o) => Math.min(2, o + 1))}
              disabled={octave >= 2}
              className={`border px-4 py-2 text-sm font-bold transition-colors ${
                octave >= 2
                  ? "border-white/10 text-gray-600 cursor-not-allowed"
                  : "border-white/30 text-white hover:border-white hover:bg-white/10"
              }`}
            >
              +
            </button>
          </div>
        </div>

        {/* Canvas box with controls - width matches canvas (280px + padding) */}
        <div
          className={`relative border p-3 transition-all ${
            isRecentTrigger
              ? "border-white bg-white/5"
              : "border-white/10 bg-transparent"
          }`}
          style={{ width: "fit-content" }}
        >
          {/* Top row: Draw/Erase/Clear buttons */}
          <div className="mb-2 flex gap-2">
            {(["pen", "erase"] as const).map((tool) => (
              <button
                key={tool}
                onClick={() => setDrawMode(tool)}
                className={`border px-3 py-1 text-xs uppercase tracking-widest transition-colors ${
                  drawMode === tool
                    ? "border-white bg-white text-black"
                    : "border-white/40 text-white hover:border-white"
                }`}
              >
                {tool === "pen" ? "DRAW" : "ERASE"}
              </button>
            ))}
            <button
              onClick={() => {
                const canvas = document.getElementById(
                  "drawing-canvas"
                ) as HTMLCanvasElement;
                if (canvas) {
                  const ctx = canvas.getContext("2d");
                  if (ctx) {
                    ctx.fillStyle = "#000000";
                    ctx.fillRect(0, 0, canvas.width, canvas.height);
                    setInputArr(Array(784).fill(0));
                    setCanvasData(null);
                  }
                }
              }}
              className="border border-red-500/60 px-3 py-1 text-xs uppercase tracking-widest text-red-300 transition-colors hover:bg-red-500 hover:text-black"
            >
              CLEAR
            </button>
          </div>

          {/* Canvas */}
          <div style={{ width: 280 }}>
            <DrawingCanvas
              width={280}
              height={280}
              onChange={setInputArr}
              onCanvasImage={setCanvasData}
              hideButtons
              externalMode={drawMode}
              onClear={handleClear}
            />

            {/* Output visualization - 10 octahedrons for digits 0-9 */}
            <div className="my-2">
              <OutputVisualization activations={activations?.output} />
            </div>

            {/* Bottom row: Status + Play */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs text-gray-500">
                <span
                  className={`h-2 w-2 rounded-full ${
                    connected ? "bg-green-500" : "bg-red-500"
                  }`}
                />
                <span className="uppercase tracking-widest">
                  {connected ? "Connected" : "Connecting..."}
                </span>
              </div>
              <button
                onClick={handleTrigger}
                disabled={!connected || triggerFlash}
                className={`border px-4 py-2 text-xs uppercase tracking-widest transition-colors flex items-center gap-1 ${
                  triggerFlash
                    ? "border-white bg-white text-black"
                    : "border-white/60 text-white hover:border-white hover:bg-white/10"
                } ${!connected ? "opacity-30 cursor-not-allowed" : ""}`}
              >
                PLAY <span className="text-sm">→</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
