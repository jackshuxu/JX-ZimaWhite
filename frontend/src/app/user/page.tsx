"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DrawingCanvas } from "@/components/DrawingCanvas";
import { NeuralNetwork3D } from "@/components/NeuralNetwork3D";
import { TriggerButton } from "@/components/TriggerButton";
import { useNetwork } from "@/hooks/useNetwork";
import { getSocket } from "@/lib/socket";
import { INSTRUMENTS, type Instrument } from "@/types/network";

export default function UserPage() {
  const [inputArr, setInputArr] = useState<number[]>(Array(784).fill(0));
  const [canvasData, setCanvasData] = useState<string | null>(null);
  const { activations } = useNetwork(inputArr);

  const [username, setUsername] = useState("");
  const [instrument, setInstrument] = useState<Instrument>("pad");
  const [connected, setConnected] = useState(false);
  const [lastTrigger, setLastTrigger] = useState<number | null>(null);

  const lastCanvasEmitRef = useRef(0);
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
      socket.off("connect");
      socket.off("chord:played");
    };
  }, [socket, username, instrument]);

  // Send canvas updates (throttled)
  useEffect(() => {
    if (!activations || !connected) return;

    const now = Date.now();
    if (now - lastCanvasEmitRef.current < 200) return; // 200ms throttle
    lastCanvasEmitRef.current = now;

    socket.emit("canvas:update", {
      canvas: canvasData,
      output: activations.output,
      instrument,
    });
  }, [activations, canvasData, connected, instrument, socket]);

  // Handle chord trigger
  const handleTrigger = useCallback(() => {
    if (!activations) return;
    socket.emit("chord:trigger", {
      output: activations.output,
      instrument,
    });
  }, [activations, instrument, socket]);

  // Prediction
  const prediction = useMemo(() => {
    if (!activations?.output?.length) return null;
    const max = Math.max(...activations.output);
    const idx = activations.output.indexOf(max);
    return { digit: idx, confidence: max };
  }, [activations]);

  // Flash feedback on trigger
  const isRecentTrigger = lastTrigger && Date.now() - lastTrigger < 500;

  return (
    <main className="min-h-screen bg-black text-white">
      <div className="mx-auto flex max-w-lg flex-col gap-6 px-4 py-6">
        {/* Header */}
        <header className="text-center">
          <p className="text-xs uppercase tracking-[0.5em] text-gray-500">
            MNIST ORCHESTRA
          </p>
          <h1 className="mt-1 text-xl font-bold uppercase tracking-widest">
            Participant
          </h1>
        </header>

        {/* Username input */}
        <div className="space-y-2">
          <label className="text-xs uppercase tracking-widest text-gray-500">
            Your Name
          </label>
          <input
            type="text"
            className="w-full border border-white/20 bg-transparent px-4 py-3 text-sm uppercase tracking-widest placeholder:text-gray-600 focus:border-white focus:outline-none"
            placeholder="ANONYMOUS"
            value={username}
            onChange={(e) => setUsername(e.target.value.slice(0, 12))}
          />
        </div>

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

        {/* Canvas */}
        <div
          className={`border p-4 transition-all ${
            isRecentTrigger
              ? "border-white bg-white/5"
              : "border-white/10 bg-transparent"
          }`}
        >
          <DrawingCanvas
            width={280}
            height={280}
            onChange={setInputArr}
            onCanvasImage={setCanvasData}
          />
        </div>

        {/* Prediction */}
        {prediction && (
          <div className="flex items-center justify-between border border-white/10 p-4">
            <div>
              <p className="text-xs uppercase tracking-widest text-gray-500">
                Detected
              </p>
              <p className="text-3xl font-bold">{prediction.digit}</p>
            </div>
            <div className="text-right">
              <p className="text-xs uppercase tracking-widest text-gray-500">
                Confidence
              </p>
              <p className="text-xl">
                {(prediction.confidence * 100).toFixed(0)}%
              </p>
            </div>
          </div>
        )}

        {/* 3D Preview (smaller) */}
        <div className="h-48 border border-white/10">
          <NeuralNetwork3D
            layers={{
              input: inputArr,
              hidden1: activations?.hidden1,
              hidden2: activations?.hidden2,
              output: activations?.output,
            }}
          />
        </div>

        {/* Trigger button */}
        <TriggerButton onTrigger={handleTrigger} disabled={!connected} />

        {/* Status */}
        <div className="flex items-center justify-center gap-2 text-xs text-gray-500">
          <span
            className={`h-2 w-2 rounded-full ${
              connected ? "bg-green-500" : "bg-red-500"
            }`}
          />
          <span className="uppercase tracking-widest">
            {connected ? "Connected" : "Connecting..."}
          </span>
        </div>
      </div>
    </main>
  );
}
