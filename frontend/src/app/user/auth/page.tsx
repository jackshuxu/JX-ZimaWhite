"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";

type AnimationPhase = "welcome" | "transitioning" | "title" | "form";

// ASCII characters for glitch effect
const GLITCH_CHARS = "!@#$%^&*()_+-=[]{}|;':\",./<>?`~0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

// Hook for ASCII glitch text effect
function useGlitchText(targetText: string, isActive: boolean, duration: number = 800) {
  const [displayText, setDisplayText] = useState(targetText);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (!isActive) {
      setDisplayText(targetText);
      return;
    }

    const chars = targetText.split("");
    const revealed = new Array(chars.length).fill(false);
    let revealCount = 0;
    const revealInterval = duration / chars.length;

    // Start with all random
    setDisplayText(
      chars.map((c) => (c === " " || c === "\n" ? c : GLITCH_CHARS[Math.floor(Math.random() * GLITCH_CHARS.length)])).join("")
    );

    // Gradually reveal characters
    intervalRef.current = setInterval(() => {
      if (revealCount < chars.length) {
        // Find next non-revealed, non-space character
        let idx = revealCount;
        while (idx < chars.length && (revealed[idx] || chars[idx] === " " || chars[idx] === "\n")) {
          if (chars[idx] === " " || chars[idx] === "\n") revealed[idx] = true;
          idx++;
        }
        if (idx < chars.length) {
          revealed[idx] = true;
        }
        revealCount++;

        setDisplayText(
          chars
            .map((c, i) => {
              if (c === " " || c === "\n") return c;
              if (revealed[i]) return c;
              return GLITCH_CHARS[Math.floor(Math.random() * GLITCH_CHARS.length)];
            })
            .join("")
        );
      }
    }, revealInterval);

    // Cleanup after duration
    timeoutRef.current = setTimeout(() => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      setDisplayText(targetText);
    }, duration + 100);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [targetText, isActive, duration]);

  return displayText;
}

export default function AuthPage() {
  const router = useRouter();
  const [phase, setPhase] = useState<AnimationPhase>("welcome");
  const [nickname, setNickname] = useState("");
  const [welcomeGlitchActive, setWelcomeGlitchActive] = useState(true);
  const [titleGlitchActive, setTitleGlitchActive] = useState(false);

  // Glitch text hooks
  const welcomeText = useGlitchText("WELCOME", welcomeGlitchActive, 600);
  const mnistText = useGlitchText("MNIST", titleGlitchActive, 400);
  const orchestraText = useGlitchText("ORCHESTRA", titleGlitchActive, 500);

  // Animation sequence
  useEffect(() => {
    const timers: NodeJS.Timeout[] = [];

    // Welcome glitch finishes after 600ms
    timers.push(
      setTimeout(() => {
        setWelcomeGlitchActive(false);
      }, 700)
    );

    // Phase 1: Welcome stays for 2s, then transition
    timers.push(
      setTimeout(() => {
        setPhase("transitioning");
      }, 2000)
    );

    // Phase 2: Title appears and glitches in
    timers.push(
      setTimeout(() => {
        setPhase("title");
        setTitleGlitchActive(true);
      }, 2800)
    );

    // Title glitch finishes
    timers.push(
      setTimeout(() => {
        setTitleGlitchActive(false);
      }, 3400)
    );

    // Phase 3: Show form after title settles
    timers.push(
      setTimeout(() => {
        setPhase("form");
      }, 3600)
    );

    return () => timers.forEach((t) => clearTimeout(t));
  }, []);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const name = nickname.trim() || "ANONYMOUS";
      // Store nickname and redirect to user page
      localStorage.setItem("mnist_nickname", name);
      router.push("/user");
    },
    [nickname, router]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        handleSubmit(e);
      }
    },
    [handleSubmit]
  );

  return (
    <main className="fixed inset-0 flex flex-col items-center justify-center overflow-hidden bg-black font-mono">
      {/* Scanline overlay */}
      <div className="pointer-events-none fixed inset-0 z-50 opacity-[0.03]">
        <div className="h-full w-full bg-[repeating-linear-gradient(0deg,transparent,transparent_2px,rgba(255,255,255,0.1)_2px,rgba(255,255,255,0.1)_4px)]" />
      </div>

      {/* Ambient glow background */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute left-1/2 top-1/2 h-[600px] w-[600px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/[0.02] blur-[100px]" />
      </div>

      {/* Welcome text container */}
      <div
        className={`relative z-10 transition-all duration-1000 ease-out ${
          phase === "welcome"
            ? "translate-y-0 opacity-100"
            : "-translate-y-[30vh] scale-75 opacity-0"
        }`}
      >
        <h1 className="bloom-text select-none text-center text-5xl font-bold uppercase tracking-[0.3em] text-white sm:text-6xl md:text-7xl">
          {welcomeText}
        </h1>
      </div>

      {/* Title text - appears after transition */}
      <div
        className={`absolute left-1/2 z-10 -translate-x-1/2 transition-all duration-700 ease-out ${
          phase === "title" || phase === "form"
            ? "top-[10vh] opacity-100"
            : "top-[50vh] opacity-0"
        }`}
      >
        <h2 className="bloom-text select-none text-center text-3xl font-bold uppercase tracking-[0.5em] text-white sm:text-4xl">
          {mnistText}
        </h2>
        <h2 className="bloom-text mt-1 select-none text-center text-2xl font-bold uppercase tracking-[0.4em] text-white sm:text-3xl">
          {orchestraText}
        </h2>
        <div className="mt-3 flex justify-center">
          <div className="h-[1px] w-32 bg-gradient-to-r from-transparent via-white/50 to-transparent bloom-line" />
        </div>
      </div>

      {/* Form container */}
      <div
        className={`absolute left-1/2 z-10 flex w-full max-w-sm -translate-x-1/2 flex-col items-center gap-6 px-6 transition-all duration-700 ease-out ${
          phase === "form"
            ? "top-[35vh] opacity-100"
            : "top-[50vh] opacity-0 pointer-events-none"
        }`}
      >
        {/* Subtitle */}
        <p className="text-center text-xs uppercase tracking-[0.5em] text-white/40 bloom-text-subtle">
          Enter the orchestra
        </p>

        {/* Form box with corner decorations */}
        <div className="relative w-full px-4 py-6">
          {/* Corner decorations - positioned relative to this container */}
          <div className="pointer-events-none absolute -left-1 -top-1 opacity-30">
            <svg width="24" height="24" viewBox="0 0 24 24" className="bloom-svg">
              <path d="M0 0 L0 12 L2 12 L2 2 L12 2 L12 0 Z" fill="white" />
            </svg>
          </div>
          <div className="pointer-events-none absolute -right-1 -top-1 opacity-30">
            <svg width="24" height="24" viewBox="0 0 24 24" className="bloom-svg">
              <path d="M24 0 L24 12 L22 12 L22 2 L12 2 L12 0 Z" fill="white" />
            </svg>
          </div>
          <div className="pointer-events-none absolute -bottom-1 -left-1 opacity-30">
            <svg width="24" height="24" viewBox="0 0 24 24" className="bloom-svg">
              <path d="M0 24 L0 12 L2 12 L2 22 L12 22 L12 24 Z" fill="white" />
            </svg>
          </div>
          <div className="pointer-events-none absolute -bottom-1 -right-1 opacity-30">
            <svg width="24" height="24" viewBox="0 0 24 24" className="bloom-svg">
              <path d="M24 24 L24 12 L22 12 L22 22 L12 22 L12 24 Z" fill="white" />
            </svg>
          </div>

          {/* Form content */}
          <div className="flex flex-col items-center gap-6">
            {/* Input */}
            <div className="w-full">
              <div className="relative">
                <input
                  type="text"
                  value={nickname}
                  onChange={(e) => setNickname(e.target.value.toUpperCase().slice(0, 12))}
                  onKeyDown={handleKeyDown}
                  placeholder="YOUR NICKNAME"
                  maxLength={12}
                  autoFocus={phase === "form"}
                  className="bloom-input w-full border border-white/20 bg-black/50 px-6 py-4 text-center text-lg uppercase tracking-[0.3em] text-white placeholder:text-white/20 focus:border-white/60 focus:outline-none"
                />
                {/* Input glow effect */}
                <div className="pointer-events-none absolute inset-0 border border-white/10 blur-sm" />
              </div>
            </div>

            {/* Enter button */}
            <button
              onClick={handleSubmit}
              className="bloom-button group relative overflow-hidden border border-white/30 bg-transparent px-12 py-4 text-sm uppercase tracking-[0.4em] text-white transition-all duration-300 hover:border-white hover:bg-white hover:text-black"
            >
              <span className="relative z-10">ENTER</span>
              {/* Button glow */}
              <div className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100">
                <div className="absolute inset-0 bg-white blur-md" />
              </div>
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}

