"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { DrawingCanvas } from "@/components/DrawingCanvas";
import { NeuralNetwork3D } from "@/components/NeuralNetwork3D";
import { useNetwork } from "@/hooks/useNetwork";
import { getSocket } from "@/lib/socket";
import type { SoloActivationPayload } from "@/types/network";

export default function SoloPage() {
  const [inputArr, setInputArr] = useState<number[]>(Array(784).fill(0));
  const { activations, error } = useNetwork(inputArr);
  const lastEmitRef = useRef(0);
  const [connected, setConnected] = useState(false);

  const socket = useMemo(() => getSocket(), []);

  // Join solo room on mount
  useEffect(() => {
    socket.emit("solo:join", {});

    socket.on("solo:joined", () => {
      setConnected(true);
    });

    socket.on("connect", () => {
      socket.emit("solo:join", {});
    });

    return () => {
      socket.off("solo:joined");
      socket.off("connect");
    };
  }, [socket]);

  // Stream activations to backend (throttled)
  useEffect(() => {
    if (!activations || !connected) return;

    const now = Date.now();
    if (now - lastEmitRef.current < 100) return; // 100ms throttle
    lastEmitRef.current = now;

    const payload: SoloActivationPayload = {
      hidden1: activations.hidden1,
      hidden2: activations.hidden2,
      output: activations.output,
    };
    socket.emit("solo:activation", payload);
  }, [activations, connected, socket]);

  // Get prediction from output layer
  const prediction = useMemo(() => {
    if (!activations?.output?.length) return null;
    const max = Math.max(...activations.output);
    const idx = activations.output.indexOf(max);
    return { digit: idx, confidence: max };
  }, [activations]);

  return (
    <main className="min-h-screen bg-black text-white">
      <div className="mx-auto flex max-w-7xl flex-col gap-8 px-6 py-8 lg:flex-row">
        {/* Left: Canvas and controls */}
        <div className="flex-1 space-y-6">
          <header className="flex items-center justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.5em] text-gray-500">
                SOLO MODE
              </p>
              <h1 className="mt-1 text-2xl font-bold uppercase tracking-widest">
                Neural Constellation
              </h1>
            </div>
            <Link
              href="/conductor"
              className="border border-white/30 px-4 py-2 text-xs uppercase tracking-widest transition-colors hover:border-white hover:bg-white/5"
            >
              → CONDUCTOR
            </Link>
          </header>

          <div className="border border-white/10 p-6">
            <p className="mb-4 text-xs uppercase tracking-widest text-gray-500">
              Draw Digit
            </p>
            <DrawingCanvas width={360} height={360} onChange={setInputArr} />
          </div>

          {/* Prediction display */}
          {prediction && (
            <div className="border border-white/10 p-6 text-center">
              <p className="text-xs uppercase tracking-widest text-gray-500">
                Network Prediction
              </p>
              <p className="mt-2 text-6xl font-bold">{prediction.digit}</p>
              <p className="mt-1 text-sm text-gray-400">
                {(prediction.confidence * 100).toFixed(1)}% confidence
              </p>
            </div>
          )}

          {/* Status */}
          <div className="flex items-center gap-4 text-xs text-gray-500">
            <span
              className={`h-2 w-2 rounded-full ${
                connected ? "bg-green-500" : "bg-red-500"
              }`}
            />
            <span className="uppercase tracking-widest">
              {connected ? "Streaming to Max" : "Connecting..."}
            </span>
            {error && <span className="text-red-400">{error}</span>}
          </div>
        </div>

        {/* Right: 3D Visualization */}
        <div className="flex-1 border border-white/10">
          <div className="p-4">
            <p className="text-xs uppercase tracking-widest text-gray-500">
              Neural Lattice
            </p>
          </div>
          <div className="h-[600px]">
            <NeuralNetwork3D
              layers={{
                input: inputArr,
                hidden1: activations?.hidden1,
                hidden2: activations?.hidden2,
                output: activations?.output,
              }}
            />
          </div>
        </div>
      </div>
    </main>
  );
}
