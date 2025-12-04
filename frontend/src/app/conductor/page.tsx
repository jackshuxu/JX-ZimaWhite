"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { QRCodeSVG } from "qrcode.react";
import Link from "next/link";
import { getSocket } from "@/lib/socket";
import {
  ConductorBlob,
  type CanvasParticipant,
} from "@/components/ConductorBlob";
import type { CrowdSnapshot, ChordPlayedEvent } from "@/types/network";

// Hardcoded URLs for production
const VERCEL_USER_PAGE = "https://mnist-orchestra-one.vercel.app";
const NGROK_SERVER = "https://mnist-orchestra.ngrok.io";

export default function ConductorPage() {
  const [snapshot, setSnapshot] = useState<CrowdSnapshot | null>(null);
  const [showQR, setShowQR] = useState(false);
  const [showTitle, setShowTitle] = useState(true);
  const [triggeredIds, setTriggeredIds] = useState<Set<string>>(new Set());
  const [serverUrl, setServerUrl] = useState(NGROK_SERVER);
  const [audioBloom, setAudioBloom] = useState(0);

  const socket = useMemo(() => getSocket(), []);

  // The QR code always points to Vercel user page with ngrok server
  const joinUrl = useMemo(() => {
    return `${VERCEL_USER_PAGE}/user?server=${encodeURIComponent(serverUrl)}`;
  }, [serverUrl]);

  // Convert snapshot participants to blob format
  const blobParticipants: CanvasParticipant[] = useMemo(() => {
    if (!snapshot) return [];
    return snapshot.participants.map((p) => ({
      id: p.socketId,
      username: p.username || "anon",
      instrument: p.instrument,
      imageUrl: p.canvas,
    }));
  }, [snapshot]);

  // Handle chord trigger with audio bloom effect
  const handleChordPlayed = useCallback((data: ChordPlayedEvent) => {
    // Add to triggered set for visual feedback
    setTriggeredIds((prev) => new Set(prev).add(data.socketId));

    // Trigger audio bloom
    setAudioBloom(1);

    // Fade out audio bloom
    const fadeBloom = () => {
      setAudioBloom((prev) => {
        const next = prev * 0.92;
        if (next > 0.01) {
          requestAnimationFrame(fadeBloom);
          return next;
        }
        return 0;
      });
    };
    requestAnimationFrame(fadeBloom);

    // Remove from triggered set after animation
    setTimeout(() => {
      setTriggeredIds((prev) => {
        const next = new Set(prev);
        next.delete(data.socketId);
        return next;
      });
    }, 500);
  }, []);

  // Join as conductor
  useEffect(() => {
    socket.emit("crowd:join", { role: "conductor" });

    socket.on("crowd:joined", () => {
      console.log("Conductor joined");
    });

    socket.on("crowd:snapshot", (data: CrowdSnapshot) => {
      setSnapshot(data);
    });

    socket.on("chord:played", handleChordPlayed);

    socket.on("connect", () => {
      socket.emit("crowd:join", { role: "conductor" });
    });

    return () => {
      socket.off("crowd:joined");
      socket.off("crowd:snapshot");
      socket.off("chord:played");
      socket.off("connect");
    };
  }, [socket, handleChordPlayed]);

  // Fade out title after 5 seconds
  useEffect(() => {
    const timer = setTimeout(() => setShowTitle(false), 5000);
    return () => clearTimeout(timer);
  }, []);

  return (
    <main className="relative h-screen w-screen overflow-hidden bg-black">
      {/* Audio-reactive blob with connected canvases and labels */}
      <ConductorBlob
        participants={blobParticipants}
        triggeredIds={triggeredIds}
        audioBloom={audioBloom}
      />

      {/* Fading title overlay */}
      {showTitle && (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center animate-fade-out">
          <h1 className="text-6xl font-bold uppercase tracking-[0.3em] text-white md:text-8xl drop-shadow-[0_0_30px_rgba(255,255,255,0.5)]">
            MNIST ORCHESTRA
          </h1>
        </div>
      )}

      {/* Top controls */}
      <div className="absolute left-4 top-4 z-30 flex gap-4">
        <Link
          href="/solo"
          className="border border-white/30 bg-black/50 px-4 py-2 text-xs uppercase tracking-widest backdrop-blur transition-colors hover:border-white"
        >
          ← SOLO
        </Link>
        <button
          onClick={() => setShowQR(!showQR)}
          className={`border px-4 py-2 text-xs uppercase tracking-widest backdrop-blur transition-colors ${
            showQR
              ? "border-white bg-white text-black"
              : "border-white/30 bg-black/50 hover:border-white"
          }`}
        >
          {showQR ? "HIDE QR" : "SHOW QR"}
        </button>
      </div>

      {/* Participant count with limit */}
      <div className="absolute bottom-4 left-4 z-30">
        <p className="text-xs uppercase tracking-widest text-white/50">
          {snapshot?.participantCount ?? 0} / {snapshot?.maxParticipants ?? 25} participants
        </p>
      </div>

      {/* QR Code overlay */}
      {showQR && (
        <div className="absolute right-4 top-4 z-30 flex flex-col items-end gap-4 rounded border border-white/20 bg-black/80 p-6 backdrop-blur">
          <QRCodeSVG value={joinUrl || "https://example.com"} size={180} />
          <p className="max-w-[180px] break-all text-xs text-gray-400">
            {joinUrl}
          </p>
          <input
            type="text"
            value={serverUrl}
            onChange={(e) => setServerUrl(e.target.value)}
            placeholder="Server URL (ngrok)"
            className="w-full border border-white/20 bg-transparent px-2 py-1 text-xs text-white placeholder:text-gray-600"
          />
        </div>
      )}

      {/* Empty state */}
      {(!snapshot || snapshot.participants.length === 0) && !showTitle && (
        <div className="absolute inset-x-0 bottom-[15%] z-10 flex justify-center pointer-events-none">
          <p className="text-xl uppercase tracking-widest text-gray-600">
            Waiting for participants...
          </p>
        </div>
      )}
    </main>
  );
}
