"use client";

import { useEffect, useRef, type MutableRefObject } from "react";
import * as THREE from "three";

type LayerActivations = number[];

type Props = {
  layers?: {
    input?: LayerActivations;
    hidden1?: LayerActivations;
    hidden2?: LayerActivations;
    output?: LayerActivations;
  };
};

/**
 * 3D wireframe visualization of a neural network.
 * Layers: 784 (input) → 128 (hidden1) → 64 (hidden2) → 10 (output)
 * Each neuron is a wireframe cube whose opacity/color reflects activation.
 */
export function NeuralNetwork3D({ layers }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const layerRefs = useRef<THREE.LineSegments[][]>([]);
  const animationRef = useRef<number | null>(null);

  // Initialize scene
  useEffect(() => {
    if (!containerRef.current) return;
    const container = containerRef.current;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000000);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(
      45,
      container.clientWidth / container.clientHeight,
      0.1,
      1000
    );
    camera.position.set(0, 0, 55);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(container.clientWidth, container.clientHeight);
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    createNeuralNetwork(scene, layerRefs);

    const animate = () => {
      animationRef.current = requestAnimationFrame(animate);
      scene.rotation.y += 0.002;
      renderer.render(scene, camera);
    };
    animate();

    const onResize = () => {
      if (!cameraRef.current || !rendererRef.current || !containerRef.current) {
        return;
      }
      const { clientWidth, clientHeight } = containerRef.current;
      cameraRef.current.aspect = clientWidth / clientHeight;
      cameraRef.current.updateProjectionMatrix();
      rendererRef.current.setSize(clientWidth, clientHeight);
    };

    window.addEventListener("resize", onResize);

    return () => {
      window.removeEventListener("resize", onResize);
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      if (rendererRef.current) rendererRef.current.dispose();
      if (container && renderer.domElement.parentElement === container) {
        container.removeChild(renderer.domElement);
      }
      layerRefs.current = [];
    };
  }, []);

  // Update neuron colors/opacity based on activations
  useEffect(() => {
    if (!layers || !layerRefs.current.length) return;
    const { input = [], hidden1 = [], hidden2 = [], output = [] } = layers;
    const layerActivations = [
      normalize(input),
      normalize(hidden1),
      normalize(hidden2),
      normalize(output),
    ];

    layerActivations.forEach((activation, index) => {
      const neurons = layerRefs.current[index];
      if (!neurons) return;
      activation.forEach((value, idx) => {
        const neuron = neurons[idx];
        if (!neuron) return;
        const opacity = Math.max(0.1, value);
        const material = neuron.material as THREE.LineBasicMaterial;
        material.opacity = opacity;
        // Color: blue (low) → cyan → green → yellow → red (high)
        material.color = new THREE.Color(`hsl(${(1 - value) * 240}, 80%, 60%)`);
      });
    });
  }, [layers]);

  return (
    <div
      ref={containerRef}
      className="h-full w-full border border-white/5 bg-black"
    />
  );
}

function normalize(values: number[]): number[] {
  if (!values.length) return [];
  const max = Math.max(...values.map((v) => Math.abs(v))) || 1;
  return values.map((v) => Math.min(1, Math.abs(v) / max));
}

function createNeuralNetwork(
  scene: THREE.Scene,
  layerRefs: MutableRefObject<THREE.LineSegments[][]>
) {
  const layers: THREE.LineSegments[][] = [];
  const layerSizes = [784, 128, 64, 10];
  const layerSpacing = 12;

  layerSizes.forEach((size, layerIdx) => {
    const neurons: THREE.LineSegments[] = [];
    const gridSize = Math.ceil(Math.sqrt(size));
    const spacing = layerIdx === 0 ? 0.4 : 1.5;

    for (let i = 0; i < size; i++) {
      const row = Math.floor(i / gridSize);
      const col = i % gridSize;
      const geometry = new THREE.BoxGeometry(
        layerIdx === 0 ? 0.1 : 0.35,
        layerIdx === 0 ? 0.1 : 0.35,
        layerIdx === 0 ? 0.1 : 0.35
      );
      const edges = new THREE.EdgesGeometry(geometry);
      const material = new THREE.LineBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.2,
      });
      const box = new THREE.LineSegments(edges, material);
      box.position.x = (col - gridSize / 2) * spacing;
      box.position.y = (row - gridSize / 2) * spacing;
      box.position.z = layerIdx * layerSpacing - 24;

      scene.add(box);
      neurons.push(box);
    }

    layers.push(neurons);
  });

  // Add sparse connections between layers
  for (let l = 0; l < layers.length - 1; l++) {
    const currentLayer = layers[l];
    const nextLayer = layers[l + 1];
    // Sample rate: fewer connections from input layer (too dense)
    const connectionSampleRate = l === 0 ? 0.001 : 0.04;

    currentLayer.forEach((neuron1) => {
      nextLayer.forEach((neuron2) => {
        if (Math.random() < connectionSampleRate) {
          const points = [neuron1.position.clone(), neuron2.position.clone()];
          const geometry = new THREE.BufferGeometry().setFromPoints(points);
          const material = new THREE.LineBasicMaterial({
            color: 0xffffff,
            transparent: true,
            opacity: 0.05,
          });
          const line = new THREE.Line(geometry, material);
          scene.add(line);
        }
      });
    });
  }

  layerRefs.current = layers;
}
