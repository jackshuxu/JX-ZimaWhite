"use client";

import Link from "next/link";

export default function LandingPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-black px-6">
      <div className="flex flex-col items-center gap-12">
        <header className="text-center">
          <p className="text-xs uppercase tracking-[0.6em] text-gray-500">
            NN / SONIFICATION
          </p>
          <h1 className="mt-4 text-4xl font-bold uppercase tracking-widest text-white md:text-6xl">
            MNIST Orchestra
          </h1>
        </header>

        <div className="flex flex-col gap-4 sm:flex-row sm:gap-8">
          <Link
            href="/solo"
            className="group flex flex-col items-center border border-white/30 px-12 py-8 transition-all hover:border-white hover:bg-white/5"
          >
            <span className="text-2xl font-bold uppercase tracking-[0.4em] text-white">
              SOLO
            </span>
            <span className="mt-2 text-xs uppercase tracking-widest text-gray-500 group-hover:text-gray-400">
              Full NN visualization
            </span>
          </Link>

          <Link
            href="/conductor"
            className="group flex flex-col items-center border border-white/30 px-12 py-8 transition-all hover:border-white hover:bg-white/5"
          >
            <span className="text-2xl font-bold uppercase tracking-[0.4em] text-white">
              CONDUCTOR
            </span>
            <span className="mt-2 text-xs uppercase tracking-widest text-gray-500 group-hover:text-gray-400">
              Orchestra mode
            </span>
          </Link>
        </div>

        <p className="max-w-md text-center text-sm text-gray-600">
          Solo mode streams all neural network activations to MaxMSP. Conductor
          mode displays participant canvases and receives triggered chords.
        </p>
      </div>
    </main>
  );
}
