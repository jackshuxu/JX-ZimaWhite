"use client";

import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { QRCodeSVG } from "qrcode.react";
import Link from "next/link";
import { getSocket } from "@/lib/socket";
import {
  ConductorBlob,
  type CanvasParticipant,
} from "@/components/ConductorBlob";
import { useConductorSonification } from "@/hooks/useConductorSonification";
import type { CrowdSnapshot, ChordPlayedEvent } from "@/types/network";

// Hardcoded URLs for production
const VERCEL_USER_PAGE = "https://mnist-orchestra-one.vercel.app";
const NGROK_SERVER = "https://mnist-orchestra.ngrok.io";

// ASCII glitch characters
const GLITCH_CHARS = "!@#$%^&*()_+-=[]{}|;:,.<>?/\\~`01█▓▒░▀▄▌▐";
const TARGET_TEXT = "ZIMA WHITE";

/**
 * Glitch text component with ASCII scramble effect
 */
function GlitchText({ onComplete }: { onComplete: () => void }) {
  const [displayText, setDisplayText] = useState(
    Array(TARGET_TEXT.length).fill("*").join("")
  );
  const [glitchOpacity, setGlitchOpacity] = useState(1);

  useEffect(() => {
    const revealedChars = new Array(TARGET_TEXT.length).fill(false);
    let revealed = 0;

    // Phase 1: Glitch scramble
    const glitchInterval = setInterval(() => {
      setDisplayText(
        TARGET_TEXT.split("")
          .map((char, i) => {
            if (revealedChars[i]) return char;
            if (char === " ") return " ";
            return GLITCH_CHARS[
              Math.floor(Math.random() * GLITCH_CHARS.length)
            ];
          })
          .join("")
      );
    }, 40);

    // Phase 2: Reveal characters one by one (faster)
    const revealInterval = setInterval(() => {
      if (revealed >= TARGET_TEXT.length) {
        clearInterval(revealInterval);
        return;
      }

      // Pick a random unrevealed character
      const unrevealed = revealedChars
        .map((r, i) => (!r && TARGET_TEXT[i] !== " " ? i : -1))
        .filter((i) => i !== -1);

      if (unrevealed.length > 0) {
        const idx = unrevealed[Math.floor(Math.random() * unrevealed.length)];
        revealedChars[idx] = true;
        revealed++;
      }
    }, 70);

    // Phase 3: All revealed, stop glitching (1.5s)
    const stopGlitch = setTimeout(() => {
      clearInterval(glitchInterval);
      setDisplayText(TARGET_TEXT);
    }, 1500);

    // Phase 4: Fade out (2s)
    const fadeOut = setTimeout(() => {
      setGlitchOpacity(0);
    }, 2000);

    // Phase 5: Complete (3s)
    const complete = setTimeout(() => {
      onComplete();
    }, 3000);

    return () => {
      clearInterval(glitchInterval);
      clearInterval(revealInterval);
      clearTimeout(stopGlitch);
      clearTimeout(fadeOut);
      clearTimeout(complete);
    };
  }, [onComplete]);

  return (
    <h1
      className="text-5xl font-bold uppercase tracking-[0.25em] text-white md:text-7xl lg:text-8xl font-mono transition-opacity duration-700"
      style={{ opacity: glitchOpacity }}
    >
      {displayText}
    </h1>
  );
}

export default function ConductorPage() {
  const [snapshot, setSnapshot] = useState<CrowdSnapshot | null>(null);
  const [showQR, setShowQR] = useState(false);
  const [introPhase, setIntroPhase] = useState<"title" | "fading" | "done">(
    "title"
  );
  const [triggeredIds, setTriggeredIds] = useState<Set<string>>(new Set());
  const [serverUrl, setServerUrl] = useState(NGROK_SERVER);
  const [audioBloom, setAudioBloom] = useState(0);
  const [audioEnabled, setAudioEnabled] = useState(false);

  const socket = useMemo(() => getSocket(), []);

  // Sonification hook
  const { playChord, initAudio } = useConductorSonification({
    enabled: audioEnabled,
    masterVolume: 0.6,
  });

  // Handle audio toggle (must init on user click for Web Audio)
  const handleAudioToggle = useCallback(() => {
    const newEnabled = !audioEnabled;
    setAudioEnabled(newEnabled);
    if (newEnabled) {
      initAudio();
    }
  }, [audioEnabled, initAudio]);

  // Ref to access playChord in callbacks without causing re-renders
  const playChordRef = useRef(playChord);
  playChordRef.current = playChord;

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

  // Handle chord trigger with audio bloom effect and sonification
  const handleChordPlayed = useCallback((data: ChordPlayedEvent) => {
    // Add to triggered set for visual feedback
    setTriggeredIds((prev) => new Set(prev).add(data.socketId));

    // Trigger audio bloom
    setAudioBloom(1);

    // Play the chord sound
    playChordRef.current(data);

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

  // Handle intro completion
  const handleIntroComplete = useCallback(() => {
    setIntroPhase("fading");
    // After fade transition completes, mark as done
    setTimeout(() => setIntroPhase("done"), 1000);
  }, []);

  return (
    <main className="relative h-screen w-screen overflow-hidden bg-black">
      {/* Audio-reactive blob with connected canvases and labels */}
      <div
        className="transition-opacity duration-700"
        style={{ opacity: introPhase === "title" ? 0 : 1 }}
      >
        <ConductorBlob
          participants={blobParticipants}
          triggeredIds={triggeredIds}
          audioBloom={audioBloom}
        />
      </div>

      {/* Intro overlay with glitch title */}
      {introPhase !== "done" && (
        <div
          className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center bg-black transition-opacity duration-700"
          style={{ opacity: introPhase === "fading" ? 0 : 1 }}
        >
          <GlitchText onComplete={handleIntroComplete} />
        </div>
      )}

      {/* Top controls */}
      <div
        className="absolute left-4 top-4 z-30 flex gap-4 transition-opacity duration-700"
        style={{ opacity: introPhase === "title" ? 0 : 1 }}
      >
        <Link
          href="/solo"
          className="border border-white/30 bg-black/50 px-4 py-2 text-xs uppercase tracking-widest backdrop-blur transition-colors hover:border-white"
        >
          ← SOLO
        </Link>
        <button
          onClick={handleAudioToggle}
          className={`flex items-center gap-2 border border-white/20 bg-black/60 px-4 py-2 text-xs uppercase tracking-widest backdrop-blur-md transition-colors ${
            audioEnabled ? "text-cyan-400" : "text-gray-500 hover:text-white"
          }`}
        >
          <span
            className={`h-2 w-2 rounded-full transition-colors ${
              audioEnabled ? "bg-cyan-400 animate-pulse" : "bg-gray-600"
            }`}
          />
          {audioEnabled ? "Audio On" : "Audio Off"}
        </button>
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
      <div
        className="absolute bottom-4 left-4 z-30 transition-opacity duration-700"
        style={{ opacity: introPhase === "title" ? 0 : 1 }}
      >
        <p className="text-xs uppercase tracking-widest text-white/50">
          {snapshot?.participantCount ?? 0} / {snapshot?.maxParticipants ?? 25}{" "}
          participants
        </p>
      </div>

      {/* QR Code overlay */}
      {showQR && (
        <div className="absolute right-4 top-4 z-30 flex flex-col items-end gap-4 rounded border border-white/20 bg-black/80 p-6 backdrop-blur">
          <QRCodeSVG value={joinUrl || "https://example.com"} size={360} />
          <p className="max-w-[360px] break-all text-xs text-gray-400">
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
      {(!snapshot || snapshot.participants.length === 0) &&
        introPhase === "done" && (
          <div className="absolute inset-x-0 bottom-[15%] z-10 flex justify-center pointer-events-none">
            <p className="text-xl uppercase tracking-widest text-gray-600">
              Waiting for participants...
            </p>
          </div>
        )}
    </main>
  );
}
