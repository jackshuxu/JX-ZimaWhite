"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Web Audio sonification hook for neural network activations.
 *
 * Synth voices:
 * - Pad: sine + LPF, slow linen envelope (for h1/h2 hidden layers)
 * - Lead: dual sine + LFO-modulated LPF, percussive (for h1 bells)
 * - Soft bell: gentler lead variant (for output arpeggio)
 *
 * Routines:
 * - Pad: every 4-5 sec
 * - Lead: every 0.1-1.1 sec
 * - Arp: confidence-scaled interval (1-10 sec)
 */

// Natural minor scale degrees (semitones from root)
const SCALE = [0, 2, 3, 5, 7, 8, 10];

// Envelope durations (seconds)
const LEAD_DURATION = 1.8;
const PAD_DURATION = 2.2;
const LFO_RATE = 0.5; // Hz

/**
 * Quantize a MIDI note to the nearest scale degree
 */
function quantize(midiNote: number): number {
  const octave = Math.floor(midiNote / 12);
  const degree = midiNote % 12;

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

/**
 * Get max value from array efficiently
 */
function getMaxValue(arr: number[]): number {
  if (arr.length === 0) return 0;
  let max = arr[0];
  for (let i = 1; i < arr.length; i++) {
    if (arr[i] > max) max = arr[i];
  }
  return max;
}

type SonificationOptions = {
  enabled: boolean;
  masterVolume?: number;
};

type SonificationState = {
  isPlaying: boolean;
  audioContextState: AudioContextState | null;
  hiddenBloom: number; // Bloom for hidden layers (pad/lead)
  outputBloom: number; // Bloom for output layer (arp)
};

export function useSonification(
  h1: number[] | null,
  h2: number[] | null,
  output: number[] | null,
  options: SonificationOptions
): SonificationState {
  const { enabled, masterVolume = 0.5 } = options;

  // Audio refs
  const audioCtxRef = useRef<AudioContext | null>(null);
  const masterGainRef = useRef<GainNode | null>(null);

  // Interval refs
  const padIntervalRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const leadIntervalRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const arpIntervalRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduledBellsRef = useRef<Set<ReturnType<typeof setTimeout>>>(
    new Set()
  );

  // Animation ref
  const animationRef = useRef<number | null>(null);

  // Data refs (avoid stale closures)
  const h1Ref = useRef<number[]>(h1 ?? []);
  const h2Ref = useRef<number[]>(h2 ?? []);
  const outputRef = useRef<number[]>(output ?? []);

  // Trigger timestamps for visual envelope
  const lastLeadTriggerRef = useRef<number>(0);
  const lastPadTriggerRef = useRef<number>(0);
  const lastArpTriggerRef = useRef<number>(0);

  // Bloom values ref (avoid setState every frame)
  const bloomValuesRef = useRef({ hidden: 0, output: 0 });

  const [state, setState] = useState<SonificationState>({
    isPlaying: false,
    audioContextState: null,
    hiddenBloom: 0,
    outputBloom: 0,
  });

  // Keep data refs updated
  useEffect(() => {
    h1Ref.current = h1 ?? [];
  }, [h1]);

  useEffect(() => {
    h2Ref.current = h2 ?? [];
  }, [h2]);

  useEffect(() => {
    outputRef.current = output ?? [];
  }, [output]);

  /**
   * Create a pad synth voice
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

    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = freq;

    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 800;
    filter.Q.value = 0.7;

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
   * Create a lead synth voice (bells)
   */
  const createLeadVoice = useCallback((freq: number, amp: number) => {
    const ctx = audioCtxRef.current;
    const master = masterGainRef.current;
    if (!ctx || !master || amp < 0.001) return;

    const now = ctx.currentTime;
    const lfoRate = 0.15 + Math.random() * 0.7;
    const filterCenter = 400;
    const filterDepth = 200;
    const attack = 0.001 + Math.random() * 0.004;
    const decay = 1.8;
    const duration = attack + decay;

    const osc1 = ctx.createOscillator();
    osc1.type = "sine";
    osc1.frequency.value = freq;

    const osc2 = ctx.createOscillator();
    osc2.type = "sine";
    osc2.frequency.value = freq * 2.01;

    const harmonicGain = ctx.createGain();
    harmonicGain.gain.value = 0.4;

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
    filter.Q.value = 5;

    lfo.connect(lfoGain);
    lfoGain.connect(filter.frequency);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(amp * 1.5, now);
    gain.gain.setValueAtTime(amp, now + attack);
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
   * Create a soft bell voice for arpeggio
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
   * Schedule a soft bell note with cleanup tracking
   * Also retriggers the arp envelope when each note plays
   */
  const createScheduledBell = useCallback(
    (freq: number, amp: number, delayTime: number) => {
      if (!audioCtxRef.current) return;

      const timeoutId = setTimeout(() => {
        scheduledBellsRef.current.delete(timeoutId);
        createSoftBellVoice(freq, amp);
        // Retrigger arp envelope when each note plays (keeps bloom alive)
        lastArpTriggerRef.current = performance.now();
      }, delayTime * 1000);

      scheduledBellsRef.current.add(timeoutId);
    },
    [createSoftBellVoice]
  );

  /**
   * Clear all scheduled bells
   */
  const clearScheduledBells = useCallback(() => {
    scheduledBellsRef.current.forEach((id) => clearTimeout(id));
    scheduledBellsRef.current.clear();
  }, []);

  /**
   * Run pad routine
   */
  const runPadRoutine = useCallback(() => {
    const h1Data = h1Ref.current;
    const h2Data = h2Ref.current;
    let triggered = false;

    h1Data.forEach((v, i) => {
      if (v > 0.01) {
        const freq = midiToFreq(quantize(i));
        createPadVoice(freq, v * 0.003 * masterVolume);
        triggered = true;
      }
    });

    h2Data.forEach((v, i) => {
      if (v > 0.01) {
        const freq = midiToFreq(quantize(i + 36));
        createPadVoice(freq, v * 0.0015 * masterVolume);
        triggered = true;
      }
    });

    if (triggered) {
      lastPadTriggerRef.current = performance.now();
    }
  }, [createPadVoice, masterVolume]);

  /**
   * Run lead routine
   */
  const runLeadRoutine = useCallback(() => {
    const h1Data = h1Ref.current;
    let triggered = false;

    h1Data.forEach((v, i) => {
      if (v > 0.05) {
        const freq = midiToFreq(quantize(i + 24));
        createLeadVoice(freq, v * 0.006 * masterVolume);
        triggered = true;
      }
    });

    if (triggered) {
      lastLeadTriggerRef.current = performance.now();
    }
  }, [createLeadVoice, masterVolume]);

  /**
   * Run arpeggio routine
   */
  const runArpRoutine = useCallback(() => {
    const outputData = outputRef.current;
    if (!outputData.length) return;

    const activeNotes: { index: number; amp: number }[] = [];
    outputData.forEach((v, i) => {
      if (v > 0.2) {
        activeNotes.push({ index: i, amp: v });
      }
    });

    if (activeNotes.length === 0) return;

    lastArpTriggerRef.current = performance.now();

    // Random sequence with 2-4 repetitions
    const repetitions = Math.floor(rrand(2, 5));
    const arpPattern: typeof activeNotes = [];
    for (let r = 0; r < repetitions; r++) {
      arpPattern.push(...shuffleArray(activeNotes));
    }

    // Schedule with timing variation
    const baseInterval = 0.12;
    let accumulatedTime = 0;
    arpPattern.forEach((note) => {
      const freq = midiToFreq(quantize(note.index + 60));
      const amp = note.amp * 0.08 * masterVolume;
      createScheduledBell(freq, amp, accumulatedTime);
      accumulatedTime += baseInterval * rrand(0.7, 1.4);
    });
  }, [createScheduledBell, masterVolume]);

  /**
   * Schedule pad routine
   */
  const schedulePad = useCallback(() => {
    if (!enabled || !audioCtxRef.current) return;
    runPadRoutine();
    const nextInterval = rrand(4000, 5000);
    padIntervalRef.current = setTimeout(schedulePad, nextInterval);
  }, [enabled, runPadRoutine]);

  /**
   * Schedule lead routine
   */
  const scheduleLead = useCallback(() => {
    if (!enabled || !audioCtxRef.current) return;
    runLeadRoutine();
    const nextInterval = rrand(100, 1100);
    leadIntervalRef.current = setTimeout(scheduleLead, nextInterval);
  }, [enabled, runLeadRoutine]);

  /**
   * Schedule arp routine (confidence-scaled interval)
   */
  const scheduleArp = useCallback(() => {
    if (!enabled || !audioCtxRef.current) return;
    runArpRoutine();

    const maxConfidence = getMaxValue(outputRef.current) || 0.5;
    const confidenceMultiplier = 1 + (1 - Math.max(0.1, maxConfidence)) * 4;
    const baseInterval = rrand(1000, 2000);
    const nextInterval = baseInterval * confidenceMultiplier;

    arpIntervalRef.current = setTimeout(scheduleArp, nextInterval);
  }, [enabled, runArpRoutine]);

  /**
   * Initialize audio context
   */
  const initAudio = useCallback(async () => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new AudioContext();
      const master = audioCtxRef.current.createGain();
      master.gain.value = 1;
      master.connect(audioCtxRef.current.destination);
      masterGainRef.current = master;
    }

    if (audioCtxRef.current.state === "suspended") {
      await audioCtxRef.current.resume();
    }

    return audioCtxRef.current;
  }, []);

  /**
   * Compute envelope value
   */
  const computeEnvelope = useCallback(
    (triggerTime: number, duration: number): number => {
      if (triggerTime === 0) return 0;
      const elapsed = (performance.now() - triggerTime) / 1000;
      if (elapsed > duration) return 0;

      const attackTime = 0.01;
      if (elapsed < attackTime) {
        return elapsed / attackTime;
      }

      const decayElapsed = elapsed - attackTime;
      const decayDuration = duration - attackTime;
      return Math.exp((-4 * decayElapsed) / decayDuration);
    },
    []
  );

  /**
   * Animation loop for bloom values
   */
  const startAnimation = useCallback(() => {
    let lastUpdate = 0;
    const UPDATE_INTERVAL = 50; // Update React state at 20fps max

    const animate = (timestamp: number) => {
      const now = performance.now();

      // Compute separate envelope values for hidden vs output layers
      const leadEnv = computeEnvelope(
        lastLeadTriggerRef.current,
        LEAD_DURATION
      );
      const padEnv = computeEnvelope(lastPadTriggerRef.current, PAD_DURATION);
      const arpEnv = computeEnvelope(lastArpTriggerRef.current, LEAD_DURATION);

      // Hidden layers: respond to pad/lead only (dimmer)
      const hiddenEnv = Math.max(leadEnv, padEnv) * 0.3;

      // Compute LFO for hidden layers
      let hiddenLfo = 0;
      if (hiddenEnv > 0.01) {
        const hiddenTrigger = Math.max(
          lastLeadTriggerRef.current,
          lastPadTriggerRef.current
        );
        const lfoElapsed = (now - hiddenTrigger) / 1000;
        const phase = (lfoElapsed * LFO_RATE) % 1;
        hiddenLfo = phase < 0.5 ? phase * 2 : 2 - phase * 2;
      }
      const hiddenBloom = hiddenEnv * (0.6 + hiddenLfo * 0.4);

      // Output layer: respond to arp only (full brightness)
      let outputLfo = 0;
      if (arpEnv > 0.01) {
        const lfoElapsed = (now - lastArpTriggerRef.current) / 1000;
        const phase = (lfoElapsed * LFO_RATE) % 1;
        outputLfo = phase < 0.5 ? phase * 2 : 2 - phase * 2;
      }
      const outputBloom = arpEnv * (0.6 + outputLfo * 0.4);

      // Store in ref (always updated)
      bloomValuesRef.current = { hidden: hiddenBloom, output: outputBloom };

      // Throttle React state updates
      if (timestamp - lastUpdate > UPDATE_INTERVAL) {
        lastUpdate = timestamp;
        setState((prev) => ({
          ...prev,
          hiddenBloom,
          outputBloom,
        }));
      }

      animationRef.current = requestAnimationFrame(animate);
    };

    animationRef.current = requestAnimationFrame(animate);
  }, [computeEnvelope]);

  /**
   * Stop animation
   */
  const stopAnimation = useCallback(() => {
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }
    bloomValuesRef.current = { hidden: 0, output: 0 };
    setState((prev) => ({ ...prev, hiddenBloom: 0, outputBloom: 0 }));
  }, []);

  /**
   * Start/stop based on enabled state
   */
  useEffect(() => {
    if (enabled) {
      initAudio().then(() => {
        setState({
          isPlaying: true,
          audioContextState: audioCtxRef.current?.state ?? null,
          hiddenBloom: 0,
          outputBloom: 0,
        });

        startAnimation();
        setTimeout(schedulePad, 500);
        setTimeout(scheduleLead, 200);
        setTimeout(scheduleArp, 800);
      });
    } else {
      stopAnimation();
      clearScheduledBells();

      if (padIntervalRef.current) {
        clearTimeout(padIntervalRef.current);
        padIntervalRef.current = null;
      }
      if (leadIntervalRef.current) {
        clearTimeout(leadIntervalRef.current);
        leadIntervalRef.current = null;
      }
      if (arpIntervalRef.current) {
        clearTimeout(arpIntervalRef.current);
        arpIntervalRef.current = null;
      }

      setState({
        isPlaying: false,
        audioContextState: audioCtxRef.current?.state ?? null,
        hiddenBloom: 0,
        outputBloom: 0,
      });
    }

    return () => {
      stopAnimation();
      clearScheduledBells();
      if (padIntervalRef.current) clearTimeout(padIntervalRef.current);
      if (leadIntervalRef.current) clearTimeout(leadIntervalRef.current);
      if (arpIntervalRef.current) clearTimeout(arpIntervalRef.current);
    };
  }, [
    enabled,
    initAudio,
    schedulePad,
    scheduleLead,
    scheduleArp,
    startAnimation,
    stopAnimation,
    clearScheduledBells,
  ]);

  /**
   * Cleanup on unmount
   */
  useEffect(() => {
    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      clearScheduledBells();
      if (padIntervalRef.current) clearTimeout(padIntervalRef.current);
      if (leadIntervalRef.current) clearTimeout(leadIntervalRef.current);
      if (arpIntervalRef.current) clearTimeout(arpIntervalRef.current);
      if (audioCtxRef.current) {
        audioCtxRef.current.close();
        audioCtxRef.current = null;
      }
    };
  }, [clearScheduledBells]);

  return state;
}
