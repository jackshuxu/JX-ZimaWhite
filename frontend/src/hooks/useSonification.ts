"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Web Audio sonification hook that recreates the SuperCollider logic.
 *
 * SuperCollider original:
 * - Scale: [0, 2, 3, 5, 7, 8, 10] (natural minor/Aeolian)
 * - Pad synth: sine + LPF at 2000Hz, linen envelope (0.5, 1.2, 0.5)
 * - Lead synth: sine + harmonic, LFO modulated RLPF, perc envelope
 * - Pad routine: every 4-5 sec, plays h1 (MIDI = i) and h2 (MIDI = i + 36)
 * - Lead routine: every 0.1-1.1 sec, plays h1 (MIDI = i + 24)
 */

// Natural minor scale degrees (semitones from root)
const SCALE = [0, 2, 3, 5, 7, 8, 10];

/**
 * Quantize a MIDI note to the nearest scale degree
 */
function quantize(midiNote: number): number {
  const octave = Math.floor(midiNote / 12);
  const degree = midiNote % 12;

  // Find nearest scale degree
  let nearestDeg = SCALE[0];
  let minDist = Math.abs(SCALE[0] - degree);

  for (const d of SCALE) {
    const dist = Math.abs(d - degree);
    if (dist < minDist) {
      minDist = dist;
      nearestDeg = d;
    }
  }

  return octave * 12 + nearestDeg;
}

/**
 * Convert MIDI note to frequency, clamped to audible range
 */
function midiToFreq(midi: number): number {
  // Clamp MIDI note to reasonable range (C1 = 24 to C7 = 96)
  const clampedMidi = Math.max(24, Math.min(96, midi));
  return 440 * Math.pow(2, (clampedMidi - 69) / 12);
}

/**
 * Random number in range [min, max]
 */
function rrand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

type SonificationOptions = {
  enabled: boolean;
  masterVolume?: number; // 0-1, default 0.5
};

type SonificationState = {
  isPlaying: boolean;
  audioContextState: AudioContextState | null;
};

export function useSonification(
  h1: number[] | null,
  h2: number[] | null,
  options: SonificationOptions
): SonificationState {
  const { enabled, masterVolume = 0.5 } = options;

  const audioCtxRef = useRef<AudioContext | null>(null);
  const masterGainRef = useRef<GainNode | null>(null);
  const padIntervalRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const leadIntervalRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const h1Ref = useRef<number[]>(h1 ?? []);
  const h2Ref = useRef<number[]>(h2 ?? []);

  const [state, setState] = useState<SonificationState>({
    isPlaying: false,
    audioContextState: null,
  });

  // Keep refs updated
  useEffect(() => {
    h1Ref.current = h1 ?? [];
  }, [h1]);

  useEffect(() => {
    h2Ref.current = h2 ?? [];
  }, [h2]);

  /**
   * Create a pad synth voice
   * - Sine oscillator
   * - Low-pass filter at 2000Hz
   * - Linen envelope (attack, sustain, release)
   */
  const createPadVoice = useCallback((freq: number, amp: number) => {
    const ctx = audioCtxRef.current;
    const master = masterGainRef.current;
    if (!ctx || !master || amp < 0.001) return;

    const now = ctx.currentTime;
    const attack = 0.5;
    const sustain = 1.2;
    const release = 0.5;
    const duration = attack + sustain + release;

    // Oscillator
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = freq;

    // Low-pass filter at 2000Hz
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 2000;
    filter.Q.value = 0.5;

    // Envelope gain
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(amp, now + attack);
    gain.gain.setValueAtTime(amp, now + attack + sustain);
    gain.gain.linearRampToValueAtTime(0, now + duration);

    // Connect: osc -> filter -> gain -> master
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(master);

    osc.start(now);
    osc.stop(now + duration + 0.1);

    // Cleanup
    osc.onended = () => {
      osc.disconnect();
      filter.disconnect();
      gain.disconnect();
    };
  }, []);

  /**
   * Create a lead synth voice
   * - Two sine oscillators (fundamental + 2.01x harmonic)
   * - Resonant low-pass filter with LFO modulation
   * - Percussive envelope
   */
  const createLeadVoice = useCallback((freq: number, amp: number) => {
    const ctx = audioCtxRef.current;
    const master = masterGainRef.current;
    if (!ctx || !master || amp < 0.001) return;

    const now = ctx.currentTime;

    // LFO-derived values (simplified: random at trigger time)
    const lfoPhase = Math.random();
    const cutoff = 300 + lfoPhase * 1700; // 300-2000Hz range
    const attack = 0.001 + lfoPhase * 0.029; // 0.001-0.03
    const decay = 1.5;
    const duration = attack + decay;

    // Main oscillator
    const osc1 = ctx.createOscillator();
    osc1.type = "sine";
    osc1.frequency.value = freq;

    // Harmonic oscillator (2.01x for slight detuning/richness)
    const osc2 = ctx.createOscillator();
    osc2.type = "sine";
    osc2.frequency.value = freq * 2.01;

    // Mix harmonic at 0.4 amplitude
    const harmonicGain = ctx.createGain();
    harmonicGain.gain.value = 0.4;

    // Mixer
    const mixer = ctx.createGain();
    mixer.gain.value = 1;

    // Resonant low-pass filter
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(cutoff, now);
    // Envelope modulates filter downward during decay (clamped to avoid negative)
    filter.frequency.linearRampToValueAtTime(
      Math.max(200, cutoff - 500),
      now + duration
    );
    filter.Q.value = 2; // Some resonance

    // Percussive envelope (perc: quick attack, exponential decay)
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(amp, now + attack);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

    // Connect
    osc1.connect(mixer);
    osc2.connect(harmonicGain);
    harmonicGain.connect(mixer);
    mixer.connect(filter);
    filter.connect(gain);
    gain.connect(master);

    osc1.start(now);
    osc2.start(now);
    osc1.stop(now + duration + 0.1);
    osc2.stop(now + duration + 0.1);

    // Cleanup
    osc1.onended = () => {
      osc1.disconnect();
      osc2.disconnect();
      harmonicGain.disconnect();
      mixer.disconnect();
      filter.disconnect();
      gain.disconnect();
    };
  }, []);

  /**
   * Run pad routine once
   * Iterates through h1 and h2, creating pad voices
   */
  const runPadRoutine = useCallback(() => {
    const h1Data = h1Ref.current;
    const h2Data = h2Ref.current;

    // h1: MIDI note = index, amp = value * 0.002
    h1Data.forEach((v, i) => {
      if (v > 0.01) {
        const midiNote = quantize(i);
        const freq = midiToFreq(midiNote);
        createPadVoice(freq, v * 0.002 * masterVolume);
      }
    });

    // h2: MIDI note = index + 36, amp = value * 0.001
    h2Data.forEach((v, i) => {
      if (v > 0.01) {
        const midiNote = quantize(i + 36);
        const freq = midiToFreq(midiNote);
        createPadVoice(freq, v * 0.001 * masterVolume);
      }
    });
  }, [createPadVoice, masterVolume]);

  /**
   * Run lead routine once
   * Iterates through h1, creating lead voices
   */
  const runLeadRoutine = useCallback(() => {
    const h1Data = h1Ref.current;

    // h1: MIDI note = index + 24, amp = value * 0.02
    h1Data.forEach((v, i) => {
      if (v > 0.05) {
        const midiNote = quantize(i + 24);
        const freq = midiToFreq(midiNote);
        createLeadVoice(freq, v * 0.02 * masterVolume);
      }
    });
  }, [createLeadVoice, masterVolume]);

  /**
   * Schedule next pad iteration with random interval
   */
  const schedulePad = useCallback(() => {
    if (!enabled || !audioCtxRef.current) return;

    runPadRoutine();

    // Schedule next: 4-5 seconds
    const nextInterval = rrand(4000, 5000);
    padIntervalRef.current = setTimeout(schedulePad, nextInterval);
  }, [enabled, runPadRoutine]);

  /**
   * Schedule next lead iteration with random interval
   */
  const scheduleLead = useCallback(() => {
    if (!enabled || !audioCtxRef.current) return;

    runLeadRoutine();

    // Schedule next: 0.1-1.1 seconds
    const nextInterval = rrand(100, 1100);
    leadIntervalRef.current = setTimeout(scheduleLead, nextInterval);
  }, [enabled, runLeadRoutine]);

  /**
   * Initialize or resume audio context
   */
  const initAudio = useCallback(async () => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new AudioContext();

      // Create master gain
      const master = audioCtxRef.current.createGain();
      master.gain.value = 1;
      master.connect(audioCtxRef.current.destination);
      masterGainRef.current = master;
    }

    // Resume if suspended (browser autoplay policy)
    if (audioCtxRef.current.state === "suspended") {
      await audioCtxRef.current.resume();
    }

    return audioCtxRef.current;
  }, []);

  /**
   * Start/stop based on enabled state
   */
  useEffect(() => {
    if (enabled) {
      // Start sonification
      initAudio().then(() => {
        setState({
          isPlaying: true,
          audioContextState: audioCtxRef.current?.state ?? null,
        });

        // Start routines with slight offset to avoid initial burst
        setTimeout(schedulePad, 500);
        setTimeout(scheduleLead, 200);
      });
    } else {
      // Stop sonification
      if (padIntervalRef.current) {
        clearTimeout(padIntervalRef.current);
        padIntervalRef.current = null;
      }
      if (leadIntervalRef.current) {
        clearTimeout(leadIntervalRef.current);
        leadIntervalRef.current = null;
      }

      setState({
        isPlaying: false,
        audioContextState: audioCtxRef.current?.state ?? null,
      });
    }

    return () => {
      if (padIntervalRef.current) {
        clearTimeout(padIntervalRef.current);
      }
      if (leadIntervalRef.current) {
        clearTimeout(leadIntervalRef.current);
      }
    };
  }, [enabled, initAudio, schedulePad, scheduleLead]);

  /**
   * Cleanup on unmount
   */
  useEffect(() => {
    return () => {
      if (padIntervalRef.current) clearTimeout(padIntervalRef.current);
      if (leadIntervalRef.current) clearTimeout(leadIntervalRef.current);
      if (audioCtxRef.current) {
        audioCtxRef.current.close();
        audioCtxRef.current = null;
      }
    };
  }, []);

  return state;
}
