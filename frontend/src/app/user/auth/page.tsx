"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";

type AnimationPhase = "welcome" | "transitioning" | "title" | "form";

export default function AuthPage() {
  const router = useRouter();
  const [phase, setPhase] = useState<AnimationPhase>("welcome");
  const [nickname, setNickname] = useState("");
  const [glitchKey, setGlitchKey] = useState(0);

  // Animation sequence
  useEffect(() => {
    const timers: NodeJS.Timeout[] = [];

    // Phase 1: Welcome stays for 2s
    timers.push(
      setTimeout(() => {
        setPhase("transitioning");
        setGlitchKey((k) => k + 1);
      }, 2000)
    );

    // Phase 2: Transition to title (1s transition)
    timers.push(
      setTimeout(() => {
        setPhase("title");
        setGlitchKey((k) => k + 1);
      }, 3000)
    );

    // Phase 3: Show form after title settles (0.8s)
    timers.push(
      setTimeout(() => {
        setPhase("form");
      }, 3800)
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
    <main className="fixed inset-0 flex flex-col items-center justify-center overflow-hidden bg-black">
      {/* Scanline overlay */}
      <div className="pointer-events-none fixed inset-0 z-50 opacity-[0.03]">
        <div className="h-full w-full bg-[repeating-linear-gradient(0deg,transparent,transparent_2px,rgba(255,255,255,0.1)_2px,rgba(255,255,255,0.1)_4px)]" />
      </div>

      {/* Ambient glow background */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute left-1/2 top-1/2 h-[600px] w-[600px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/[0.02] blur-[100px]" />
      </div>

      {/* Main text container */}
      <div
        className={`relative z-10 transition-all duration-1000 ease-out ${
          phase === "welcome"
            ? "translate-y-0"
            : phase === "transitioning"
              ? "-translate-y-[30vh] scale-75 opacity-0"
              : "-translate-y-[35vh]"
        }`}
      >
        {/* Welcome text - visible in welcome phase */}
        <h1
          key={`welcome-${glitchKey}`}
          className={`glitch-text bloom-text select-none text-center text-5xl font-bold uppercase tracking-[0.3em] text-white sm:text-6xl md:text-7xl ${
            phase === "welcome" ? "opacity-100" : "opacity-0"
          } transition-opacity duration-500`}
          data-text="WELCOME"
        >
          WELCOME
        </h1>
      </div>

      {/* Title text - appears after transition */}
      <div
        className={`absolute left-1/2 z-10 -translate-x-1/2 transition-all duration-700 ease-out ${
          phase === "title" || phase === "form"
            ? "top-[12vh] opacity-100"
            : "top-[50vh] opacity-0"
        }`}
      >
        <h2
          key={`title-${glitchKey}`}
          className={`glitch-text bloom-text select-none whitespace-nowrap text-center text-2xl font-bold uppercase tracking-[0.4em] text-white sm:text-3xl ${
            phase === "title" || phase === "form" ? "animate-glitch-in" : ""
          }`}
          data-text="MNIST ORCHESTRA"
        >
          MNIST ORCHESTRA
        </h2>
        <div className="mt-2 flex justify-center">
          <div className="h-[1px] w-32 bg-gradient-to-r from-transparent via-white/50 to-transparent bloom-line" />
        </div>
      </div>

      {/* Form container */}
      <div
        className={`absolute left-1/2 z-10 flex w-full max-w-sm -translate-x-1/2 flex-col items-center gap-8 px-6 transition-all duration-700 ease-out ${
          phase === "form"
            ? "top-[35vh] opacity-100"
            : "top-[50vh] opacity-0 pointer-events-none"
        }`}
      >
        {/* Subtitle */}
        <p className="text-center text-xs uppercase tracking-[0.5em] text-white/40 bloom-text-subtle">
          Enter the orchestra
        </p>

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

        {/* Corner decorations */}
        <div className="pointer-events-none fixed bottom-8 left-8 opacity-20">
          <svg width="40" height="40" viewBox="0 0 40 40" className="bloom-svg">
            <path d="M0 40 L0 20 L2 20 L2 38 L20 38 L20 40 Z" fill="white" />
          </svg>
        </div>
        <div className="pointer-events-none fixed bottom-8 right-8 opacity-20">
          <svg width="40" height="40" viewBox="0 0 40 40" className="bloom-svg">
            <path d="M40 40 L40 20 L38 20 L38 38 L20 38 L20 40 Z" fill="white" />
          </svg>
        </div>
        <div className="pointer-events-none fixed top-8 left-8 opacity-20">
          <svg width="40" height="40" viewBox="0 0 40 40" className="bloom-svg">
            <path d="M0 0 L0 20 L2 20 L2 2 L20 2 L20 0 Z" fill="white" />
          </svg>
        </div>
        <div className="pointer-events-none fixed top-8 right-8 opacity-20">
          <svg width="40" height="40" viewBox="0 0 40 40" className="bloom-svg">
            <path d="M40 0 L40 20 L38 20 L38 2 L20 2 L20 0 Z" fill="white" />
          </svg>
        </div>
      </div>
    </main>
  );
}

