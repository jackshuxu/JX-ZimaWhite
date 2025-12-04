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
  bloomEnvelope?: number; // 0-1, envelope triggered by sounds
  bloomLfo?: number; // 0-1, LFO modulation within envelope
};

// Neuron structure: group containing fill mesh, edge wireframe, and optional glow sprite
type NeuronGroup = THREE.Group & {
  userData: {
    fillMesh: THREE.Mesh<THREE.BoxGeometry, THREE.MeshBasicMaterial>;
    edgeMesh: THREE.LineSegments<THREE.EdgesGeometry, THREE.LineBasicMaterial>;
    glowSprite: THREE.Sprite | null; // null for input layer (no bloom)
    baseSize: number; // Store base size for glow scaling
  };
};

// Connection line with source/target indices for activation updates
type Connection = {
  line: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  sourceLayer: number;
  sourceIdx: number;
  targetLayer: number;
  targetIdx: number;
};

// Output layer colors - one per digit (cycles through for 10 outputs)
const OUTPUT_COLORS = [
  new THREE.Color(0x53ff4b), // green
  new THREE.Color(0x59eafd), // cyan
  new THREE.Color(0xf30472), // pink
  new THREE.Color(0xf97020), // orange
];

// White for intermediate layers
const WHITE = new THREE.Color(0xffffff);

// Reusable color objects for hot path (avoid allocations)
const tempColor = new THREE.Color();
const boostedColor = new THREE.Color();

// Get color for intermediate layers (white with brightness based on activation)
function getIntermediateColor(value: number): THREE.Color {
  const brightness = 0.3 + value * 0.7; // 0.3 to 1.0 brightness
  tempColor.copy(WHITE).multiplyScalar(brightness);
  return tempColor;
}

// Get color for output layer (specific color per digit)
function getOutputColor(digitIndex: number): THREE.Color {
  return OUTPUT_COLORS[digitIndex % OUTPUT_COLORS.length];
}

/**
 * 3D visualization of a neural network with filled boxes.
 * Layers: 784 (input) → 128 (hidden1) → 64 (hidden2) → 10 (output)
 * Each neuron is a box filled with color based on activation level.
 */
export function NeuralNetwork3D({
  layers,
  bloomEnvelope = 0,
  bloomLfo = 0,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const layerRefs = useRef<NeuronGroup[][]>([]);
  const connectionRefs = useRef<Connection[]>([]);
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
    camera.position.set(0, 0, 115); // Keep same distance so objects appear bigger
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(container.clientWidth, container.clientHeight);
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    createNeuralNetwork(scene, layerRefs, connectionRefs);

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

      // Dispose all geometries, materials, and textures
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.geometry?.dispose();
          if (object.material instanceof THREE.Material) {
            object.material.dispose();
          }
        }
        if (
          object instanceof THREE.LineSegments ||
          object instanceof THREE.Line
        ) {
          object.geometry?.dispose();
          if (object.material instanceof THREE.Material) {
            object.material.dispose();
          }
        }
        if (object instanceof THREE.Sprite) {
          if (object.material instanceof THREE.SpriteMaterial) {
            object.material.map?.dispose();
            object.material.dispose();
          }
        }
      });

      if (rendererRef.current) {
        rendererRef.current.dispose();
        rendererRef.current.forceContextLoss();
      }
      if (container && renderer.domElement.parentElement === container) {
        container.removeChild(renderer.domElement);
      }
      layerRefs.current = [];
      connectionRefs.current = [];
    };
  }, []);

  // Update neuron colors/opacity based on activations and audio envelope
  useEffect(() => {
    if (!layers || !layerRefs.current.length) return;
    const { input = [], hidden1 = [], hidden2 = [], output = [] } = layers;
    const layerActivations = [
      normalize(input),
      normalize(hidden1),
      normalize(hidden2),
      normalize(output),
    ];

    // Bloom modulation: envelope gates the bloom, LFO modulates within envelope
    // When envelope > 0, bloom is active and follows LFO curve
    // Base bloom = envelope * (0.5 + 0.5 * lfo) for pulsing effect
    const bloomModulation =
      bloomEnvelope > 0.01 ? bloomEnvelope * (0.5 + bloomLfo * 0.5) : 0;

    // Update neurons
    layerActivations.forEach((activation, layerIndex) => {
      const neurons = layerRefs.current[layerIndex];
      if (!neurons) return;
      const isOutputLayer = layerIndex === 3;
      const isInputLayer = layerIndex === 0;

      activation.forEach((value, idx) => {
        const neuron = neurons[idx];
        if (!neuron?.userData?.fillMesh?.material) return;

        // Different color logic for output vs intermediate layers
        if (isOutputLayer) {
          // Output layer: specific color per digit, brightness based on activation
          const baseColor = getOutputColor(idx);
          const intensity = 0.4 + value * 1.6; // 0.4 to 2.0 brightness
          boostedColor.copy(baseColor).multiplyScalar(intensity);
        } else {
          // Intermediate layers: white with brightness based on activation
          const color = getIntermediateColor(value);
          const intensity = 1 + value * 0.5; // Subtle boost
          boostedColor.copy(color).multiplyScalar(intensity);
        }

        // Update fill mesh
        const fillMat = neuron.userData.fillMesh.material;
        fillMat.opacity = value * 0.9;
        fillMat.color.copy(boostedColor);

        // Update edge wireframe
        const edgeMat = neuron.userData.edgeMesh.material;
        edgeMat.opacity = Math.max(0.4, value);
        edgeMat.color.copy(boostedColor);

        // Update glow sprite - bloom triggers with sound, follows envelope + LFO
        const glow = neuron.userData.glowSprite;
        if (glow && !isInputLayer) {
          const baseSize = neuron.userData.baseSize;
          // Base bloom from activation
          const activationBloom = value * value;

          if (bloomModulation > 0.01 && activationBloom > 0.01) {
            // When sound is playing: bloom pulses with envelope + LFO
            const glowScale =
              baseSize *
              (2 + activationBloom * 6 * (0.8 + bloomModulation * 0.4));
            glow.scale.set(glowScale, glowScale, 1);
            const glowOpacity =
              activationBloom * 0.7 * (0.3 + bloomModulation * 0.7);
            (glow.material as THREE.SpriteMaterial).opacity = glowOpacity;
          } else {
            // No sound: minimal static bloom based on activation only
            const glowScale = baseSize * (2 + activationBloom * 4);
            glow.scale.set(glowScale, glowScale, 1);
            const glowOpacity = activationBloom * 0.3; // Dimmer when no sound
            (glow.material as THREE.SpriteMaterial).opacity = glowOpacity;
          }
          (glow.material as THREE.SpriteMaterial).color.copy(boostedColor);
        }
      });
    });

    // Update connection lines based on source and target activations
    connectionRefs.current.forEach((conn) => {
      const sourceActivation =
        layerActivations[conn.sourceLayer]?.[conn.sourceIdx] ?? 0;
      const targetActivation =
        layerActivations[conn.targetLayer]?.[conn.targetIdx] ?? 0;
      // Use average of source and target activations
      const avgActivation = (sourceActivation + targetActivation) / 2;

      // Connection to output layer: use target's color, otherwise white
      const isToOutput = conn.targetLayer === 3;
      if (isToOutput) {
        const baseColor = getOutputColor(conn.targetIdx);
        const intensity = 0.5 + avgActivation * 1.5;
        boostedColor.copy(baseColor).multiplyScalar(intensity);
      } else {
        // Intermediate connections: white
        const intensity = 0.3 + avgActivation * 0.7;
        boostedColor.copy(WHITE).multiplyScalar(intensity);
      }

      conn.line.material.opacity = Math.max(0.05, avgActivation * 0.7);
      conn.line.material.color.copy(boostedColor);
    });
  }, [layers, bloomEnvelope, bloomLfo]);

  return (
    <div
      ref={containerRef}
      className="h-full w-full border border-white/5 bg-black"
    />
  );
}

function normalize(values: number[]): number[] {
  if (!values.length) return [];
  // Find max without creating intermediate array
  let max = 0;
  for (let i = 0; i < values.length; i++) {
    const abs = Math.abs(values[i]);
    if (abs > max) max = abs;
  }
  max = max || 1;
  // Normalize in place to reusable array
  const result = new Array(values.length);
  for (let i = 0; i < values.length; i++) {
    result[i] = Math.min(1, Math.abs(values[i]) / max);
  }
  return result;
}

// Create bloom-like radial gradient texture for glow effect
function createGlowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext("2d")!;

  // Bloom-style gradient: bright core with soft falloff
  const gradient = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  gradient.addColorStop(0, "rgba(255, 255, 255, 1)");
  gradient.addColorStop(0.1, "rgba(255, 255, 255, 0.8)");
  gradient.addColorStop(0.2, "rgba(255, 255, 255, 0.5)");
  gradient.addColorStop(0.4, "rgba(255, 255, 255, 0.2)");
  gradient.addColorStop(0.6, "rgba(255, 255, 255, 0.08)");
  gradient.addColorStop(0.8, "rgba(255, 255, 255, 0.02)");
  gradient.addColorStop(1, "rgba(255, 255, 255, 0)");

  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 256, 256);

  const texture = new THREE.CanvasTexture(canvas);
  return texture;
}

// Cached glow texture (shared by all sprites)
let glowTexture: THREE.CanvasTexture | null = null;
function getGlowTexture(): THREE.CanvasTexture {
  if (!glowTexture) {
    glowTexture = createGlowTexture();
  }
  return glowTexture;
}

function createDigitLabel(digit: number): THREE.Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext("2d")!;

  // Draw digit
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 48px monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(digit.toString(), 32, 32);

  const texture = new THREE.CanvasTexture(canvas);
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(2.25, 2.25, 1); // 1.5x scale

  return sprite;
}

function createNeuralNetwork(
  scene: THREE.Scene,
  layerRefs: MutableRefObject<NeuronGroup[][]>,
  connectionRefs: MutableRefObject<Connection[]>
) {
  const layers: NeuronGroup[][] = [];
  const connections: Connection[] = [];
  // Actual network architecture: 784 → 128 → 16 → 10
  const layerSizes = [784, 128, 16, 10];
  const layerSpacing = 20; // Reduced to 0.5x

  layerSizes.forEach((size, layerIdx) => {
    const neurons: NeuronGroup[] = [];
    const isOutputLayer = layerIdx === 3;

    // Output layer: flat row, others: grid
    const gridSize = isOutputLayer ? size : Math.ceil(Math.sqrt(size));
    // Box sizes (1.5x scale)
    const boxSize = layerIdx === 0 ? 0.9 : 3.0;
    // Spacing (1.5x scale)
    const spacing = layerIdx === 0 ? 0.75 : 3.75;

    // Share geometry within layer (major memory optimization)
    const sharedBoxGeometry = new THREE.BoxGeometry(boxSize, boxSize, boxSize);
    const sharedEdgesGeometry = new THREE.EdgesGeometry(sharedBoxGeometry);

    for (let i = 0; i < size; i++) {
      // Output layer: single row, others: grid layout
      const rawRow = isOutputLayer ? 0 : Math.floor(i / gridSize);
      // Flip input layer vertically to match canvas (canvas Y=0 is top, 3D Y+ is up)
      const row = layerIdx === 0 ? gridSize - 1 - rawRow : rawRow;
      const col = isOutputLayer ? i : i % gridSize;
      const colOffset = isOutputLayer ? size / 2 : gridSize / 2;
      const rowOffset = isOutputLayer ? 0 : gridSize / 2;

      // Create group to hold both fill and edge
      const group = new THREE.Group() as NeuronGroup;

      // Fill mesh (solid box) - shared geometry, unique material
      const fillMaterial = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0, // Start invisible, fill on activation
      });
      const fillMesh = new THREE.Mesh(sharedBoxGeometry, fillMaterial);

      // Edge wireframe - shared geometry, unique material
      const edgeMaterial = new THREE.LineBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.5,
      });
      const edgeMesh = new THREE.LineSegments(
        sharedEdgesGeometry,
        edgeMaterial
      );

      // Glow sprite - renders behind the box, scales with activation (skip input layer)
      let glowSprite: THREE.Sprite | null = null;
      if (layerIdx !== 0) {
        const glowMaterial = new THREE.SpriteMaterial({
          map: getGlowTexture(),
          color: 0xffffff,
          transparent: true,
          opacity: 0, // Start invisible
          blending: THREE.AdditiveBlending, // Additive for neon effect
          depthWrite: false, // Don't occlude other objects
        });
        glowSprite = new THREE.Sprite(glowMaterial);
        glowSprite.scale.set(boxSize * 2, boxSize * 2, 1); // Initial bloom size
        group.add(glowSprite);
      }

      // Add to group
      group.add(fillMesh);
      group.add(edgeMesh);

      // Add digit label for output layer
      if (isOutputLayer) {
        const label = createDigitLabel(i);
        label.position.y = -boxSize * 1.2; // Below the box
        group.add(label);
      }

      // Store references in userData
      group.userData.fillMesh = fillMesh;
      group.userData.edgeMesh = edgeMesh;
      group.userData.glowSprite = glowSprite; // null for input layer
      group.userData.baseSize = boxSize;

      group.position.x =
        (col - colOffset) * spacing + (isOutputLayer ? spacing / 2 : 0);
      group.position.y = (row - rowOffset) * spacing;
      group.position.z = layerIdx * layerSpacing - 27; // Adjusted for closer layers

      scene.add(group);
      neurons.push(group);
    }

    layers.push(neurons);
  });

  // Add sparse connections between layers (using palette colors)
  for (let l = 0; l < layers.length - 1; l++) {
    const currentLayer = layers[l];
    const nextLayer = layers[l + 1];
    const connectionSampleRate = l === 0 ? 0.001 : 0.04;

    currentLayer.forEach((neuron1, srcIdx) => {
      nextLayer.forEach((neuron2, tgtIdx) => {
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

          // Store connection with indices for activation updates
          connections.push({
            line,
            sourceLayer: l,
            sourceIdx: srcIdx,
            targetLayer: l + 1,
            targetIdx: tgtIdx,
          });
        }
      });
    });
  }

  layerRefs.current = layers;
  connectionRefs.current = connections;
}
