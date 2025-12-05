"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ChordPlayedEvent } from "@/types/network";

/**
 * Conductor sonification hook for incoming chord events.
 *
 * Synth voices:
 * - Pad: sine + LPF, slow linen envelope (for pad instruments)
 * - Soft bell: dual sine + LFO-modulated LPF (for lead instruments)
 */

/**
 * Direct mapping from digit (0-9) to semitones from C.
 * Uses natural minor scale spanning 1.5 octaves for 10 unique notes.
 * Scale: C, D, Eb, F, G, Ab, Bb, C, D, Eb (no duplicates within the 10)
 */
const DIGIT_TO_SEMITONE: Record<number, number> = {
  0: 0, // C
  1: 2, // D
  2: 3, // Eb
  3: 5, // F
  4: 7, // G
  5: 8, // Ab
  6: 10, // Bb
  7: 12, // C (next octave)
  8: 14, // D (next octave)
  9: 15, // Eb (next octave)
};

/**
 * Get MIDI note for a digit with octave offset
 */
function digitToMidi(digit: number, octaveOffset: number = 0): number {
  const baseMidi = 48; // C3
  const semitone = DIGIT_TO_SEMITONE[digit] ?? 0;
  return baseMidi + semitone + octaveOffset * 12;
}

/**
 * Convert MIDI note to frequency, clamped to audible range
 */
function midiToFreq(midi: number): number {
  const clampedMidi = Math.max(24, Math.min(96, midi));
  return 440 * Math.pow(2, (clampedMidi - 69) / 12);
}

/**
 * Random number in range [min, max]
 */
function rrand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

/**
 * Fisher-Yates shuffle
 */
function shuffleArray<T>(arr: T[]): T[] {
  const shuffled = [...arr];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

type ConductorSonificationOptions = {
  enabled: boolean;
  masterVolume?: number;
};

type ConductorSonificationState = {
  isReady: boolean;
  audioContextState: AudioContextState | null;
};

export function useConductorSonification(
  options: ConductorSonificationOptions
): {
  state: ConductorSonificationState;
  playChord: (event: ChordPlayedEvent) => void;
  initAudio: () => Promise<AudioContext | null>;
} {
  const { enabled, masterVolume = 0.6 } = options;

  // Audio refs
  const audioCtxRef = useRef<AudioContext | null>(null);
  const masterGainRef = useRef<GainNode | null>(null);
  const scheduledNotesRef = useRef<Set<ReturnType<typeof setTimeout>>>(
    new Set()
  );

  const [state, setState] = useState<ConductorSonificationState>({
    isReady: false,
    audioContextState: null,
  });

  /**
   * Initialize audio context (must be called from user interaction)
   */
  const initAudio = useCallback(async () => {
    try {
      if (!audioCtxRef.current) {
        audioCtxRef.current = new AudioContext();
        const master = audioCtxRef.current.createGain();
        master.gain.value = masterVolume;
        master.connect(audioCtxRef.current.destination);
        masterGainRef.current = master;
        console.log("[ConductorAudio] AudioContext created");
      }

      if (audioCtxRef.current.state === "suspended") {
        await audioCtxRef.current.resume();
        console.log("[ConductorAudio] AudioContext resumed");
      }

      setState({
        isReady: true,
        audioContextState: audioCtxRef.current.state,
      });

      console.log("[ConductorAudio] Ready, state:", audioCtxRef.current.state);
      return audioCtxRef.current;
    } catch (err) {
      console.error("[ConductorAudio] Init failed:", err);
      return null;
    }
  }, [masterVolume]);

  /**
   * Create a pad synth voice (for pad instrument)
   */
  const createPadVoice = useCallback((freq: number, amp: number) => {
    const ctx = audioCtxRef.current;
    const master = masterGainRef.current;
    if (!ctx || !master || amp < 0.001) return;

    const now = ctx.currentTime;
    const attack = 0.3;
    const sustain = 1.0;
    const release = 0.4;
    const duration = attack + sustain + release;

    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = freq;

    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 1800;
    filter.Q.value = 0.5;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(amp, now + attack);
    gain.gain.setValueAtTime(amp, now + attack + sustain);
    gain.gain.linearRampToValueAtTime(0, now + duration);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(master);

    osc.start(now);
    osc.stop(now + duration + 0.1);

    osc.onended = () => {
      osc.disconnect();
      filter.disconnect();
      gain.disconnect();
    };
  }, []);

  /**
   * Create a soft bell voice (for lead instruments)
   */
  const createSoftBellVoice = useCallback((freq: number, amp: number) => {
    const ctx = audioCtxRef.current;
    const master = masterGainRef.current;
    if (!ctx || !master || amp < 0.001) return;

    const now = ctx.currentTime;
    const lfoRate = 0.2 + Math.random() * 0.4;
    const filterCenter = 800;
    const filterDepth = 300;
    const attack = 0.005 + Math.random() * 0.01;
    const decay = 1.2;
    const duration = attack + decay;

    const osc1 = ctx.createOscillator();
    osc1.type = "sine";
    osc1.frequency.value = freq;

    const osc2 = ctx.createOscillator();
    osc2.type = "sine";
    osc2.frequency.value = freq * 2.01;

    const harmonicGain = ctx.createGain();
    harmonicGain.gain.value = 0.3;

    const mixer = ctx.createGain();
    mixer.gain.value = 1;

    const lfo = ctx.createOscillator();
    lfo.type = "triangle";
    lfo.frequency.value = lfoRate;

    const lfoGain = ctx.createGain();
    lfoGain.gain.value = filterDepth;

    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = filterCenter;
    filter.Q.value = 3;

    lfo.connect(lfoGain);
    lfoGain.connect(filter.frequency);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(amp, now + attack);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

    osc1.connect(mixer);
    osc2.connect(harmonicGain);
    harmonicGain.connect(mixer);
    mixer.connect(filter);
    filter.connect(gain);
    gain.connect(master);

    osc1.start(now);
    osc2.start(now);
    lfo.start(now);

    osc1.stop(now + duration + 0.1);
    osc2.stop(now + duration + 0.1);
    lfo.stop(now + duration + 0.1);

    osc1.onended = () => {
      osc1.disconnect();
      osc2.disconnect();
      lfo.disconnect();
      lfoGain.disconnect();
      harmonicGain.disconnect();
      mixer.disconnect();
      filter.disconnect();
      gain.disconnect();
    };
  }, []);

  /**
   * Create a harp/plucked string voice
   * Uses multiple harmonics with fast attack and gentle decay
   */
  const createHarpVoice = useCallback((freq: number, amp: number) => {
    const ctx = audioCtxRef.current;
    const master = masterGainRef.current;
    if (!ctx || !master || amp < 0.001) return;

    const now = ctx.currentTime;
    const attack = 0.003; // Very fast attack for pluck
    const decay = 2.0; // Long, gentle decay
    const duration = attack + decay;

    // Fundamental
    const osc1 = ctx.createOscillator();
    osc1.type = "triangle"; // Softer than sine for harp
    osc1.frequency.value = freq;

    // Octave harmonic (gentle)
    const osc2 = ctx.createOscillator();
    osc2.type = "sine";
    osc2.frequency.value = freq * 2;

    // Fifth harmonic (very subtle, adds shimmer)
    const osc3 = ctx.createOscillator();
    osc3.type = "sine";
    osc3.frequency.value = freq * 3;

    // Slight detune on fundamental for richness
    const osc4 = ctx.createOscillator();
    osc4.type = "triangle";
    osc4.frequency.value = freq * 1.002;

    // Harmonic gains (fundamental loudest, harmonics quieter)
    const gain1 = ctx.createGain();
    const gain2 = ctx.createGain();
    const gain3 = ctx.createGain();
    const gain4 = ctx.createGain();

    // Envelope for each - pluck shape with exponential decay
    gain1.gain.setValueAtTime(0, now);
    gain1.gain.linearRampToValueAtTime(amp, now + attack);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + duration);

    gain2.gain.setValueAtTime(0, now);
    gain2.gain.linearRampToValueAtTime(amp * 0.3, now + attack);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + duration * 0.6);

    gain3.gain.setValueAtTime(0, now);
    gain3.gain.linearRampToValueAtTime(amp * 0.15, now + attack);
    gain3.gain.exponentialRampToValueAtTime(0.001, now + duration * 0.4);

    gain4.gain.setValueAtTime(0, now);
    gain4.gain.linearRampToValueAtTime(amp * 0.4, now + attack);
    gain4.gain.exponentialRampToValueAtTime(0.001, now + duration);

    // High-pass filter to remove muddiness
    const hpFilter = ctx.createBiquadFilter();
    hpFilter.type = "highpass";
    hpFilter.frequency.value = 80;
    hpFilter.Q.value = 0.7;

    // Warm low-pass that darkens quickly (muffled, less digital)
    const lpFilter = ctx.createBiquadFilter();
    lpFilter.type = "lowpass";
    lpFilter.frequency.setValueAtTime(freq * 3, now);
    lpFilter.frequency.exponentialRampToValueAtTime(freq * 0.8, now + 0.3);
    lpFilter.Q.value = 0.5;

    // Mixer
    const mixer = ctx.createGain();
    mixer.gain.value = 1;

    // Connect oscillators through their gains to mixer
    osc1.connect(gain1);
    osc2.connect(gain2);
    osc3.connect(gain3);
    osc4.connect(gain4);

    gain1.connect(mixer);
    gain2.connect(mixer);
    gain3.connect(mixer);
    gain4.connect(mixer);

    // Mixer through filters to master
    mixer.connect(hpFilter);
    hpFilter.connect(lpFilter);
    lpFilter.connect(master);

    // Start all oscillators
    osc1.start(now);
    osc2.start(now);
    osc3.start(now);
    osc4.start(now);

    // Stop after duration
    osc1.stop(now + duration + 0.1);
    osc2.stop(now + duration + 0.1);
    osc3.stop(now + duration + 0.1);
    osc4.stop(now + duration + 0.1);

    osc1.onended = () => {
      osc1.disconnect();
      osc2.disconnect();
      osc3.disconnect();
      osc4.disconnect();
      gain1.disconnect();
      gain2.disconnect();
      gain3.disconnect();
      gain4.disconnect();
      mixer.disconnect();
      hpFilter.disconnect();
      lpFilter.disconnect();
    };
  }, []);

  /**
   * Schedule a note with cleanup tracking
   */
  const scheduleNote = useCallback(
    (
      freq: number,
      amp: number,
      delayTime: number,
      voice: "pad" | "bell" | "harp"
    ) => {
      const timeoutId = setTimeout(() => {
        scheduledNotesRef.current.delete(timeoutId);
        if (voice === "pad") {
          createPadVoice(freq, amp);
        } else if (voice === "harp") {
          createHarpVoice(freq, amp);
        } else {
          createSoftBellVoice(freq, amp);
        }
      }, delayTime * 1000);

      scheduledNotesRef.current.add(timeoutId);
    },
    [createPadVoice, createSoftBellVoice, createHarpVoice]
  );

  /**
   * Clear all scheduled notes
   */
  const clearScheduledNotes = useCallback(() => {
    scheduledNotesRef.current.forEach((id) => clearTimeout(id));
    scheduledNotesRef.current.clear();
  }, []);

  /**
   * Play a chord based on incoming event
   */
  const playChord = useCallback(
    (event: ChordPlayedEvent) => {
      console.log("[ConductorAudio] playChord called:", {
        enabled,
        hasContext: !!audioCtxRef.current,
        contextState: audioCtxRef.current?.state,
        instrument: event.instrument,
        outputLength: event.output?.length,
      });

      if (!enabled) {
        console.log("[ConductorAudio] Skipped: not enabled");
        return;
      }

      if (!audioCtxRef.current) {
        console.log("[ConductorAudio] Skipped: no audio context");
        return;
      }

      // Resume context if suspended (can happen after tab switches)
      if (audioCtxRef.current.state === "suspended") {
        audioCtxRef.current.resume();
      }

      const { instrument, output, octave = 0 } = event;
      if (!output || output.length === 0) {
        console.log("[ConductorAudio] Skipped: no output data");
        return;
      }

      // Determine voice type based on instrument
      const voiceType: "pad" | "harp" | "bell" =
        instrument === "pad" ? "pad" : instrument === "harp" ? "harp" : "bell";

      console.log(
        "[ConductorAudio] Playing:",
        voiceType,
        "for",
        instrument,
        "octave:",
        octave
      );

      // Get active notes (activation > 0.2)
      const activeNotes: { digit: number; amp: number }[] = [];
      output.forEach((v, i) => {
        if (v > 0.2) {
          activeNotes.push({ digit: i, amp: v });
        }
      });

      if (activeNotes.length === 0) return;

      if (voiceType === "pad") {
        // Play all pad notes together (chord)
        activeNotes.forEach((note) => {
          const midi = digitToMidi(note.digit, octave);
          const freq = midiToFreq(midi);
          const amp = note.amp * 0.15 * masterVolume;
          createPadVoice(freq, amp);
        });
      } else if (voiceType === "harp") {
        // Play harp notes as gentle arpeggio
        const arpPattern = shuffleArray(activeNotes);
        const baseInterval = 0.08; // Slightly faster for harp
        let accumulatedTime = 0;
        arpPattern.forEach((note) => {
          const midi = digitToMidi(note.digit, octave + 1); // Harp sounds nice an octave up
          const freq = midiToFreq(midi);
          const amp = note.amp * 0.12 * masterVolume;
          scheduleNote(freq, amp, accumulatedTime, "harp");
          accumulatedTime += baseInterval * rrand(0.8, 1.2);
        });
      } else {
        // Play as arpeggiated bell sequence
        const repetitions = Math.floor(rrand(2, 4));
        const arpPattern: typeof activeNotes = [];
        for (let r = 0; r < repetitions; r++) {
          arpPattern.push(...shuffleArray(activeNotes));
        }

        const baseInterval = 0.1;
        let accumulatedTime = 0;
        arpPattern.forEach((note) => {
          const midi = digitToMidi(note.digit, octave);
          const freq = midiToFreq(midi);
          const amp = note.amp * 0.1 * masterVolume;
          scheduleNote(freq, amp, accumulatedTime, "bell");
          accumulatedTime += baseInterval * rrand(0.7, 1.4);
        });
      }
    },
    [enabled, masterVolume, createPadVoice, scheduleNote]
  );

  /**
   * Initialize on mount if enabled
   */
  useEffect(() => {
    if (enabled) {
      initAudio();
    }

    return () => {
      clearScheduledNotes();
    };
  }, [enabled, initAudio, clearScheduledNotes]);

  /**
   * Cleanup on unmount
   */
  useEffect(() => {
    return () => {
      clearScheduledNotes();
      if (audioCtxRef.current) {
        audioCtxRef.current.close();
        audioCtxRef.current = null;
      }
    };
  }, [clearScheduledNotes]);

  return { state, playChord, initAudio };
}
