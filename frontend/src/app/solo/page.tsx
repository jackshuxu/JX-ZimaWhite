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
    <main className="relative min-h-screen overflow-hidden bg-black text-white">
      {/* Full-screen 3D Background */}
      <div className="fixed inset-0 z-0">
        <NeuralNetwork3D
          layers={{
            input: inputArr,
            hidden1: activations?.hidden1,
            hidden2: activations?.hidden2,
            output: activations?.output,
          }}
        />
      </div>

      {/* Floating UI Layer */}
      <div className="relative z-10 flex min-h-screen flex-col p-6">
        {/* Top bar */}
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-4 text-xs text-gray-400">
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
          <Link
            href="/conductor"
            className="border border-white/30 bg-black/50 px-4 py-2 text-xs uppercase tracking-widest backdrop-blur-sm transition-colors hover:border-white hover:bg-white/10"
          >
            → CONDUCTOR
          </Link>
        </header>

        {/* Left-aligned control panel */}
        <div className="flex flex-1 items-center justify-start pl-6">
          <div className="border border-white/20 bg-black/60 backdrop-blur-md">
            {/* Digit Canvas */}
            <div className="p-6">
              <p className="mb-4 text-xs uppercase tracking-widest text-gray-500">
                Digit Canvas
              </p>
              <DrawingCanvas width={320} height={320} onChange={setInputArr} />
            </div>

            {/* Divider */}
            <div className="border-t border-white/10" />

            {/* Network Prediction */}
            <div className="p-6 text-center">
              <p className="text-xs uppercase tracking-widest text-gray-500">
                Network Prediction
              </p>
              <p className="mt-3 text-7xl font-bold tabular-nums">
                {prediction?.digit ?? "—"}
              </p>
              <p className="mt-2 text-sm text-gray-400">
                {prediction
                  ? `${(prediction.confidence * 100).toFixed(1)}% confidence`
                  : "Draw to predict"}
              </p>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
