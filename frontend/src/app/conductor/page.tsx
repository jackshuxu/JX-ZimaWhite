"use client";

import { useEffect, useMemo, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import Link from "next/link";
import { getSocket } from "@/lib/socket";
import type {
  CrowdSnapshot,
  ParticipantSnapshot,
  ChordPlayedEvent,
} from "@/types/network";

export default function ConductorPage() {
  const [snapshot, setSnapshot] = useState<CrowdSnapshot | null>(null);
  const [showQR, setShowQR] = useState(false);
  const [showTitle, setShowTitle] = useState(true);
  const [recentTriggers, setRecentTriggers] = useState<Set<string>>(new Set());
  const [serverUrl, setServerUrl] = useState("");

  const socket = useMemo(() => getSocket(), []);

  // Build QR URL
  useEffect(() => {
    if (typeof window !== "undefined") {
      // Get the ngrok URL from query param or use current origin
      const params = new URLSearchParams(window.location.search);
      const server =
        params.get("server") ||
        window.location.origin.replace(":3000", ":8000");
      setServerUrl(server);
    }
  }, []);

  const joinUrl = useMemo(() => {
    if (typeof window === "undefined") return "";
    // For Vercel deployment, point to the deployed user page with server param
    const origin = window.location.origin;
    return `${origin}/user?server=${encodeURIComponent(serverUrl)}`;
  }, [serverUrl]);

  // Join as conductor
  useEffect(() => {
    socket.emit("crowd:join", { role: "conductor" });

    socket.on("crowd:joined", () => {
      console.log("Conductor joined");
    });

    socket.on("crowd:snapshot", (data: CrowdSnapshot) => {
      setSnapshot(data);
    });

    socket.on("chord:played", (data: ChordPlayedEvent) => {
      // Add to recent triggers for visual feedback
      setRecentTriggers((prev) => new Set(prev).add(data.socketId));
      // Remove after animation
      setTimeout(() => {
        setRecentTriggers((prev) => {
          const next = new Set(prev);
          next.delete(data.socketId);
          return next;
        });
      }, 400);
    });

    socket.on("connect", () => {
      socket.emit("crowd:join", { role: "conductor" });
    });

    return () => {
      socket.off("crowd:joined");
      socket.off("crowd:snapshot");
      socket.off("chord:played");
      socket.off("connect");
    };
  }, [socket]);

  // Fade out title after 5 seconds
  useEffect(() => {
    const timer = setTimeout(() => setShowTitle(false), 5000);
    return () => clearTimeout(timer);
  }, []);

  // Generate stable positions for each participant based on socket ID
  const positions = useMemo(() => {
    const map: Record<string, { x: number; y: number; delay: number }> = {};
    snapshot?.participants.forEach((p, idx) => {
      const hash = hashString(p.socketId);
      map[p.socketId] = {
        x: 5 + (hash % 75), // 5-80% horizontal
        y: 5 + (Math.floor(hash / 7) % 75), // 5-80% vertical
        delay: idx % 4, // Animation delay variety
      };
    });
    return map;
  }, [snapshot]);

  return (
    <main className="relative h-screen w-screen overflow-hidden bg-black">
      {/* Fading title overlay */}
      {showTitle && (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center animate-fade-out">
          <h1 className="text-6xl font-bold uppercase tracking-[0.3em] text-white md:text-8xl">
            MNIST ORCHESTRA
          </h1>
        </div>
      )}

      {/* Top controls */}
      <div className="absolute left-4 top-4 z-10 flex gap-4">
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

      {/* QR Code overlay */}
      {showQR && (
        <div className="absolute right-4 top-4 z-10 flex flex-col items-end gap-4 rounded border border-white/20 bg-black/80 p-6 backdrop-blur">
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

      {/* Floating canvases */}
      <div className="absolute inset-0">
        {snapshot?.participants.map((participant) => (
          <FloatingCanvas
            key={participant.socketId}
            participant={participant}
            position={positions[participant.socketId]}
            isTriggered={recentTriggers.has(participant.socketId)}
          />
        ))}
      </div>

      {/* Empty state */}
      {(!snapshot || snapshot.participants.length === 0) && !showTitle && (
        <div className="absolute inset-0 flex items-center justify-center">
          <p className="text-xl uppercase tracking-widest text-gray-600">
            Waiting for participants...
          </p>
        </div>
      )}
    </main>
  );
}

function FloatingCanvas({
  participant,
  position,
  isTriggered,
}: {
  participant: ParticipantSnapshot;
  position?: { x: number; y: number; delay: number };
  isTriggered: boolean;
}) {
  if (!position) return null;

  const delayClass = [
    "",
    "animate-float-delay-1",
    "animate-float-delay-2",
    "animate-float-delay-3",
  ][position.delay];

  return (
    <div
      className={`absolute flex flex-col items-center gap-2 transition-all duration-300 animate-float ${delayClass} ${
        isTriggered ? "animate-glow scale-110" : ""
      }`}
      style={{
        left: `${position.x}%`,
        top: `${position.y}%`,
        transform: "translate(-50%, -50%)",
      }}
    >
      {/* Canvas image */}
      <div
        className={`border-2 transition-colors ${
          isTriggered ? "border-white" : "border-white/30"
        }`}
      >
        {participant.canvas ? (
          <img
            src={participant.canvas}
            alt={participant.username}
            className="h-24 w-24 object-cover"
          />
        ) : (
          <div className="flex h-24 w-24 items-center justify-center border border-dashed border-white/20 text-xs text-gray-600">
            ...
          </div>
        )}
      </div>

      {/* Label */}
      <div className="text-center">
        <p className="text-xs uppercase tracking-widest text-white">
          {participant.username || "anon"}
        </p>
        <p className="text-[10px] uppercase tracking-widest text-gray-500">
          {participant.instrument}
        </p>
      </div>
    </div>
  );
}

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) % 997;
  }
  return hash;
}
