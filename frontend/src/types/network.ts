/**
 * Full neural network activations from TensorFlow.js inference.
 * Used in solo mode and for local visualization.
 */
export type Activations = {
  input: number[][]; // 28x28 grayscale image
  hidden1: number[]; // 128 neurons
  hidden2: number[]; // 64 neurons
  output: number[]; // 10 class probabilities
};

/**
 * Participant data as received from the backend snapshot.
 */
export type ParticipantSnapshot = {
  socketId: string;
  instrument: string;
  username: string;
  canvas: string | null; // base64 PNG data URL
  lastSeen: string; // ISO timestamp
};

/**
 * Full crowd state snapshot from backend.
 */
export type CrowdSnapshot = {
  participants: ParticipantSnapshot[];
  participantCount: number;
  maxParticipants: number;
  hasConductor: boolean;
  instrumentMix: Record<string, number>;
};

/**
 * Error event from backend.
 */
export type CrowdError = {
  code?: string;
  message: string;
  maxParticipants?: number;
};

/**
 * Payload for solo mode activation streaming.
 */
export type SoloActivationPayload = {
  hidden1: number[];
  hidden2: number[];
  output: number[];
};

/**
 * Payload for crowd mode canvas updates.
 */
export type CanvasUpdatePayload = {
  canvas: string | null;
  output: number[] | null;
  instrument: string;
};

/**
 * Payload for crowd mode chord triggers.
 */
export type ChordTriggerPayload = {
  output?: number[];
  instrument?: string;
  octave?: number;
};

/**
 * Event received when someone triggers a chord.
 */
export type ChordPlayedEvent = {
  socketId: string;
  instrument: string;
  output: number[];
  username: string;
  octave: number;
};

/**
 * Available instruments for participants.
 */
export const INSTRUMENTS = ["pad", "harp", "lead"] as const;
export type Instrument = (typeof INSTRUMENTS)[number];
