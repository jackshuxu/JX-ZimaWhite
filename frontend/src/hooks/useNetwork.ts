import { useEffect, useRef, useState } from "react";
import * as tf from "@tensorflow/tfjs";
import type { Activations } from "@/types/network";

const WEIGHT_FILES = [
  "weight1.txt",
  "bias1.txt",
  "weight2.txt",
  "bias2.txt",
  "weight3.txt",
  "bias3.txt",
] as const;

type NetworkWeights = {
  w1: number[][];
  w2: number[][];
  w3: number[][];
  b1: number[];
  b2: number[];
  b3: number[];
};

function parseMatrix(text: string): number[][] {
  return text
    .trim()
    .split("\n")
    .map((line) => line.trim().split(/[ ,]+/).filter(Boolean).map(Number));
}

/**
 * Hook that runs TensorFlow.js inference on a 784-element input array.
 * Returns activations for all layers (input, hidden1, hidden2, output).
 */
export function useNetwork(inputArray: number[]) {
  const [activations, setActivations] = useState<Activations | null>(null);
  const [error, setError] = useState<string | null>(null);
  const weightsRef = useRef<NetworkWeights | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadAndRun() {
      try {
        const inputDim = inputArray.length;
        if (!weightsRef.current) {
          weightsRef.current = await fetchWeights(inputDim);
        }
        const { w1, w2, w3, b1, b2, b3 } = weightsRef.current;

        const x = tf.tensor2d([inputArray], [1, inputDim]);
        const tW1 = tf.tensor2d(w1);
        const tB1 = tf.tensor1d(b1);
        const tW2 = tf.tensor2d(w2);
        const tB2 = tf.tensor1d(b2);
        const tW3 = tf.tensor2d(w3);
        const tB3 = tf.tensor1d(b3);

        // Forward pass: input → hidden1 → hidden2 → output
        const m1 = x.matMul(tW1).add(tB1).relu();
        const m2 = m1.matMul(tW2).add(tB2).relu();
        const logits = m2.matMul(tW3).add(tB3);
        const out = tf.softmax(logits);

        // Extract values
        const input2d = x.reshape([28, 28]).arraySync() as number[][];
        const h1 = (m1.arraySync() as number[][])[0];
        const h2 = (m2.arraySync() as number[][])[0];
        const y = (out.arraySync() as number[][])[0];

        if (!cancelled) {
          setActivations({
            input: input2d,
            hidden1: h1,
            hidden2: h2,
            output: y,
          });
          setError(null);
        }

        // Cleanup tensors
        tf.dispose([x, tW1, tB1, tW2, tB2, tW3, tB3, m1, m2, logits, out]);
      } catch (err) {
        console.error(err);
        if (!cancelled) {
          setError((err as Error).message);
        }
      }
    }

    loadAndRun();
    return () => {
      cancelled = true;
    };
  }, [inputArray]);

  return { activations, error };
}

async function fetchWeights(inputDim: number): Promise<NetworkWeights> {
  const base = "/weights";
  const responses = await Promise.all(
    WEIGHT_FILES.map((file) =>
      fetch(`${base}/${file}`).then((res) => res.text())
    )
  );
  const [rawW1, rawB1, rawW2, rawB2, rawW3, rawB3] = responses.map(parseMatrix);

  const b1 = rawB1.flat();
  const b2 = rawB2.flat();
  const b3 = rawB3.flat();

  const reshape = (raw: number[][], rows: number, cols: number): number[][] => {
    if (raw.length === 1) {
      const flat = raw[0];
      return Array.from({ length: rows }, (_, idx) =>
        flat.slice(idx * cols, (idx + 1) * cols)
      );
    }
    return raw;
  };

  const hidden1Size = b1.length;
  const hidden2Size = b2.length;
  const outputSize = b3.length;

  const w1 = reshape(rawW1, inputDim, hidden1Size);
  const w2 = reshape(rawW2, hidden1Size, hidden2Size);
  const w3 = reshape(rawW3, hidden2Size, outputSize);

  return { w1, w2, w3, b1, b2, b3 };
}
