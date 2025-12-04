"use client";

import { useEffect, useRef, useCallback } from "react";
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import {
  CSS2DRenderer,
  CSS2DObject,
} from "three/examples/jsm/renderers/CSS2DRenderer.js";

/**
 * Color palette for impulses
 */
const COLOR_PALETTE = [
  0x53ff4b, // Bright green
  0x59eafd, // Cyan blue
  0xf30472, // Magenta pink
  0xf97020, // Orange
];

/**
 * Participant canvas data for display
 */
export type CanvasParticipant = {
  id: string;
  username: string;
  instrument: string;
  imageUrl: string | null;
};

type Props = {
  participants: CanvasParticipant[];
  triggeredIds: Set<string>;
  audioBloom?: number; // 0-1 value for audio reactivity
};

/**
 * Audio-reactive wireframe blob with connected participant canvases
 */
export function ConductorBlob({
  participants,
  triggeredIds,
  audioBloom = 0,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const labelRendererRef = useRef<CSS2DRenderer | null>(null);
  const composerRef = useRef<EffectComposer | null>(null);
  const animationIdRef = useRef<number | null>(null);

  // Core scene objects
  const sphereRef = useRef<THREE.Mesh | null>(null);
  const crosshairRef = useRef<THREE.LineSegments | null>(null);
  const originalPositionsRef = useRef<Float32Array | null>(null);

  // Canvas and connection objects
  const canvasGroupRef = useRef<THREE.Group | null>(null);

  // Texture loader and cache
  const textureLoaderRef = useRef<THREE.TextureLoader | null>(null);
  const textureCache = useRef<Map<string, THREE.Texture>>(new Map());

  // Impulse system
  const impulsesRef = useRef<
    {
      progress: number;
      participantId: string;
      speed: number;
      color: number;
    }[]
  >([]);

  // Vertex animation state
  const vertexStateRef = useRef<
    {
      offset: THREE.Vector3;
      velocity: THREE.Vector3;
      timer: number;
    }[]
  >([]);
  const vertexFadeRef = useRef<Float32Array | null>(null);
  const vertexColorsRef = useRef<Uint32Array | null>(null);

  // Adjacency map for vertex neighbors
  const adjacencyRef = useRef<number[][]>([]);

  // Tracked participant IDs for change detection
  const trackedIdsRef = useRef<string[]>([]);
  const prevTriggeredRef = useRef<Set<string>>(new Set());

  // Map of participant ID to their connection data (for incremental updates)
  const connectionMapRef = useRef<
    Map<
      string,
      {
        line: THREE.Line;
        canvasMesh: THREE.Mesh;
        borderMesh: THREE.LineSegments;
        labelObject: CSS2DObject;
        vertexIndex: number;
        fixedPosition: THREE.Vector3;
        phase: number;
        speed: number;
        glowIntensity: number;
        glowColor: number;
        material: THREE.LineBasicMaterial;
        lastImageUrl: string | null;
      }
    >
  >(new Map());

  /**
   * Initialize the Three.js scene
   */
  const initScene = useCallback(() => {
    if (!containerRef.current) return;

    const container = containerRef.current;
    const width = container.clientWidth;
    const height = container.clientHeight;

    // Scene
    const scene = new THREE.Scene();
    sceneRef.current = scene;

    // Camera
    const camera = new THREE.PerspectiveCamera(75, width / height, 0.1, 1000);
    camera.position.z = 8;
    cameraRef.current = camera;

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(width, height);
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // CSS2D Renderer for labels
    const labelRenderer = new CSS2DRenderer();
    labelRenderer.setSize(width, height);
    labelRenderer.domElement.style.position = "absolute";
    labelRenderer.domElement.style.top = "0";
    labelRenderer.domElement.style.left = "0";
    labelRenderer.domElement.style.pointerEvents = "none";
    container.appendChild(labelRenderer.domElement);
    labelRendererRef.current = labelRenderer;

    // Create sphere geometry
    const geometry = new THREE.SphereGeometry(1.2, 20, 20);
    const positions = geometry.attributes.position.array as Float32Array;

    // Add natural perturbations
    for (let i = 0; i < positions.length; i += 3) {
      const x = positions[i];
      const y = positions[i + 1];
      const z = positions[i + 2];
      const dist = Math.sqrt(x * x + y * y + z * z);
      const noise =
        Math.sin(x * 3.5) * Math.cos(y * 2.8) * Math.sin(z * 4.2) * 0.12;
      const normalizer = dist > 0 ? (1 + noise) / dist : 1;
      positions[i] = x * normalizer;
      positions[i + 1] = y * normalizer;
      positions[i + 2] = z * normalizer;
    }
    geometry.attributes.position.needsUpdate = true;

    // Store original positions
    originalPositionsRef.current = positions.slice() as Float32Array;

    // Initialize vertex colors
    const vertexCount = geometry.attributes.position.count;
    const colors = new Float32Array(vertexCount * 3);
    for (let i = 0; i < vertexCount; i++) {
      colors[i * 3] = 1.0;
      colors[i * 3 + 1] = 1.0;
      colors[i * 3 + 2] = 1.0;
    }
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));

    // Initialize vertex animation state
    vertexStateRef.current = Array(vertexCount)
      .fill(null)
      .map(() => ({
        offset: new THREE.Vector3(),
        velocity: new THREE.Vector3(),
        timer: 0,
      }));
    vertexFadeRef.current = new Float32Array(vertexCount);
    vertexColorsRef.current = new Uint32Array(vertexCount).fill(0xffffff);

    // Build adjacency list
    const adjacency: number[][] = Array(vertexCount)
      .fill(null)
      .map(() => []);
    const index = geometry.index;
    if (index) {
      for (let i = 0; i < index.count; i += 3) {
        const a = index.getX(i);
        const b = index.getX(i + 1);
        const c = index.getX(i + 2);
        if (!adjacency[a].includes(b)) adjacency[a].push(b);
        if (!adjacency[a].includes(c)) adjacency[a].push(c);
        if (!adjacency[b].includes(a)) adjacency[b].push(a);
        if (!adjacency[b].includes(c)) adjacency[b].push(c);
        if (!adjacency[c].includes(a)) adjacency[c].push(a);
        if (!adjacency[c].includes(b)) adjacency[c].push(b);
      }
    }
    adjacencyRef.current = adjacency;

    // Create sphere mesh
    const material = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      wireframe: true,
      vertexColors: true,
    });
    const sphere = new THREE.Mesh(geometry, material);
    scene.add(sphere);
    sphereRef.current = sphere;

    // Add vertex points
    const pointsGeometry = new THREE.BufferGeometry();
    pointsGeometry.setAttribute("position", geometry.attributes.position);
    const pointsMaterial = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 0.025,
    });
    const points = new THREE.Points(pointsGeometry, pointsMaterial);
    sphere.add(points);

    // Crosshair
    const crosshairGeometry = new THREE.BufferGeometry();
    const crosshairSize = 0.4;
    crosshairGeometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(
        [
          -crosshairSize,
          0,
          0,
          crosshairSize,
          0,
          0,
          0,
          -crosshairSize,
          0,
          0,
          crosshairSize,
          0,
        ],
        3
      )
    );
    const crosshairMaterial = new THREE.LineBasicMaterial({ color: 0xffffff });
    const crosshair = new THREE.LineSegments(
      crosshairGeometry,
      crosshairMaterial
    );
    scene.add(crosshair);
    crosshairRef.current = crosshair;

    // Canvas group (will hold participant canvases)
    const canvasGroup = new THREE.Group();
    scene.add(canvasGroup);
    canvasGroupRef.current = canvasGroup;

    // Texture loader for participant canvas images
    textureLoaderRef.current = new THREE.TextureLoader();

    // Post-processing for bloom effect on blob
    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    const bloomPass = new UnrealBloomPass(
      new THREE.Vector2(width, height),
      0.5, // strength
      0.4, // radius
      0.2 // threshold
    );
    composer.addPass(bloomPass);
    composerRef.current = composer;
  }, []);

  /**
   * Remove a single participant's 3D objects
   */
  const removeParticipant = useCallback((id: string) => {
    const scene = sceneRef.current;
    const canvasGroup = canvasGroupRef.current;
    const conn = connectionMapRef.current.get(id);
    if (!scene || !canvasGroup || !conn) return;

    scene.remove(conn.line);
    canvasGroup.remove(conn.canvasMesh);
    canvasGroup.remove(conn.borderMesh);
    scene.remove(conn.labelObject);

    conn.line.geometry.dispose();
    (conn.line.material as THREE.Material).dispose();
    conn.canvasMesh.geometry.dispose();
    const mat = conn.canvasMesh.material as THREE.MeshBasicMaterial;
    if (mat.map) mat.map.dispose();
    mat.dispose();
    conn.borderMesh.geometry.dispose();
    (conn.borderMesh.material as THREE.Material).dispose();
    if (conn.labelObject.element.parentNode) {
      conn.labelObject.element.parentNode.removeChild(conn.labelObject.element);
    }

    connectionMapRef.current.delete(id);
  }, []);

  /**
   * Create a single participant's 3D objects
   */
  const createParticipant = useCallback(
    (participant: CanvasParticipant, index: number, totalCount: number) => {
      const scene = sceneRef.current;
      const sphere = sphereRef.current;
      const canvasGroup = canvasGroupRef.current;
      const originalPositions = originalPositionsRef.current;
      if (!scene || !sphere || !canvasGroup || !originalPositions) return;

      const geometry = sphere.geometry as THREE.SphereGeometry;
      const vertexCount = geometry.attributes.position.count;
      const step = Math.max(1, Math.floor(vertexCount / totalCount));
      const vertexIndex = (index * step) % vertexCount;

      // Position in a circle around the blob (start at top, go clockwise)
      const angle = (index / totalCount) * Math.PI * 2 - Math.PI / 2;
      const radius = 2.8;
      const fixedPosition = new THREE.Vector3(
        Math.cos(angle) * radius,
        Math.sin(angle) * radius,
        3
      );

      // Create canvas plane
      const canvasSize = 0.65;
      const canvasGeometry = new THREE.PlaneGeometry(canvasSize, canvasSize);
      const canvasMaterial = new THREE.MeshBasicMaterial({
        color: 0x000000,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.9,
      });

      // Load texture if available
      if (participant.imageUrl && textureLoaderRef.current) {
        const cachedTexture = textureCache.current.get(participant.imageUrl);
        if (cachedTexture) {
          canvasMaterial.map = cachedTexture;
          canvasMaterial.color.setHex(0xffffff); // White to show texture properly
        } else {
          textureLoaderRef.current.load(participant.imageUrl, (texture) => {
            texture.minFilter = THREE.LinearFilter;
            texture.magFilter = THREE.LinearFilter;
            canvasMaterial.map = texture;
            canvasMaterial.color.setHex(0xffffff); // White to show texture properly
            canvasMaterial.needsUpdate = true;
            textureCache.current.set(participant.imageUrl!, texture);
          });
        }
      }

      const canvasMesh = new THREE.Mesh(canvasGeometry, canvasMaterial);
      canvasMesh.position.copy(fixedPosition);
      canvasGroup.add(canvasMesh);

      // Create wireframe border
      const borderGeometry = new THREE.EdgesGeometry(
        new THREE.PlaneGeometry(canvasSize * 1.05, canvasSize * 1.05)
      );
      const borderMaterial = new THREE.LineBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.6,
      });
      const borderMesh = new THREE.LineSegments(borderGeometry, borderMaterial);
      borderMesh.position.copy(fixedPosition);
      canvasGroup.add(borderMesh);

      // Create CSS2D label
      const labelDiv = document.createElement("div");
      labelDiv.className = "participant-label";
      labelDiv.style.cssText = `
        text-align: center;
        font-family: monospace;
        pointer-events: none;
        user-select: none;
      `;
      labelDiv.innerHTML = `
        <div style="
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.15em;
          color: rgba(255, 255, 255, 0.8);
          margin-bottom: 2px;
        ">${participant.username}</div>
        <div style="
          font-size: 9px;
          text-transform: uppercase;
          letter-spacing: 0.1em;
          color: rgba(255, 255, 255, 0.4);
        ">${participant.instrument}</div>
      `;
      const labelObject = new CSS2DObject(labelDiv);
      labelObject.position.copy(fixedPosition);
      labelObject.position.y -= canvasSize * 0.7;
      scene.add(labelObject);

      // Create connection line
      const vx = originalPositions[vertexIndex * 3];
      const vy = originalPositions[vertexIndex * 3 + 1];
      const vz = originalPositions[vertexIndex * 3 + 2];
      const lineGeometry = new THREE.BufferGeometry().setFromPoints([
        fixedPosition.clone(),
        new THREE.Vector3(vx, vy, vz),
      ]);
      const lineMaterial = new THREE.LineBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.4,
      });
      const line = new THREE.Line(lineGeometry, lineMaterial);
      scene.add(line);

      // Store in map with stable animation values
      connectionMapRef.current.set(participant.id, {
        line,
        canvasMesh,
        borderMesh,
        labelObject,
        vertexIndex,
        fixedPosition: fixedPosition.clone(),
        phase: Math.random() * Math.PI * 2,
        speed: 0.3 + Math.random() * 0.3,
        glowIntensity: 0,
        glowColor: 0xffffff,
        material: lineMaterial,
        lastImageUrl: participant.imageUrl,
      });
    },
    []
  );

  /**
   * Update a participant's texture if their image changed
   */
  const updateParticipantTexture = useCallback(
    (participant: CanvasParticipant) => {
      const conn = connectionMapRef.current.get(participant.id);
      if (!conn || conn.lastImageUrl === participant.imageUrl) return;

      // Image URL changed, update texture
      const canvasMat = conn.canvasMesh.material as THREE.MeshBasicMaterial;

      if (participant.imageUrl && textureLoaderRef.current) {
        const cachedTexture = textureCache.current.get(participant.imageUrl);
        if (cachedTexture) {
          // Dispose old texture if different
          if (canvasMat.map && canvasMat.map !== cachedTexture) {
            canvasMat.map.dispose();
          }
          canvasMat.map = cachedTexture;
          canvasMat.color.setHex(0xffffff); // White to show texture properly
          canvasMat.needsUpdate = true;
        } else {
          textureLoaderRef.current.load(participant.imageUrl, (texture) => {
            texture.minFilter = THREE.LinearFilter;
            texture.magFilter = THREE.LinearFilter;
            // Dispose old texture
            if (canvasMat.map) canvasMat.map.dispose();
            canvasMat.map = texture;
            canvasMat.color.setHex(0xffffff); // White to show texture properly
            canvasMat.needsUpdate = true;
            textureCache.current.set(participant.imageUrl!, texture);
          });
        }
      } else if (canvasMat.map) {
        // No image anymore, remove texture
        canvasMat.map.dispose();
        canvasMat.map = null;
        canvasMat.color.setHex(0x000000); // Black when no texture
        canvasMat.needsUpdate = true;
      }

      conn.lastImageUrl = participant.imageUrl;
    },
    []
  );

  /**
   * Update participant canvases and connections (incremental)
   */
  const updateParticipants = useCallback(() => {
    if (!sceneRef.current || !sphereRef.current || !canvasGroupRef.current) {
      return;
    }

    const currentIds = new Set(participants.slice(0, 25).map((p) => p.id));
    const existingIds = new Set(connectionMapRef.current.keys());

    // Remove participants that left
    existingIds.forEach((id) => {
      if (!currentIds.has(id)) {
        removeParticipant(id);
      }
    });

    // Check if we need to rebuild positions (participant count changed)
    const countChanged = currentIds.size !== existingIds.size;
    const numParticipants = Math.min(participants.length, 25);

    if (countChanged && numParticipants > 0) {
      // Participant count changed - need to reposition everyone
      // Remove all and rebuild with new positions
      existingIds.forEach((id) => removeParticipant(id));

      participants.slice(0, 25).forEach((p, i) => {
        createParticipant(p, i, numParticipants);
      });
    } else {
      // Just update textures for existing participants
      participants.slice(0, 25).forEach((p) => {
        if (connectionMapRef.current.has(p.id)) {
          updateParticipantTexture(p);
        } else {
          // New participant (shouldn't happen if counts match, but be safe)
          createParticipant(p, connectionMapRef.current.size, numParticipants);
        }
      });
    }

    // Update tracked IDs for ordering
    trackedIdsRef.current = participants.slice(0, 25).map((p) => p.id);
  }, [
    participants,
    removeParticipant,
    createParticipant,
    updateParticipantTexture,
  ]);

  /**
   * Trigger an impulse from a specific participant
   */
  const sendImpulse = useCallback((participantId: string) => {
    const conn = connectionMapRef.current.get(participantId);
    if (!conn) return;

    // Pick random color
    const color =
      COLOR_PALETTE[Math.floor(Math.random() * COLOR_PALETTE.length)];

    // Flash the canvas
    const canvasMat = conn.canvasMesh.material as THREE.MeshBasicMaterial;
    const originalColor = canvasMat.color.clone();
    canvasMat.color.setHex(color);
    setTimeout(() => canvasMat.color.copy(originalColor), 150);

    // Add impulse
    impulsesRef.current.push({
      progress: 0,
      participantId,
      speed: 0.05,
      color,
    });

    // Start glow on the connection
    conn.glowIntensity = 1;
    conn.glowColor = color;
  }, []);

  /**
   * Trigger glitch/shake on the blob
   */
  const triggerGlitch = useCallback(() => {
    const state = vertexStateRef.current;
    const origPos = originalPositionsRef.current;
    if (!state.length || !origPos) return;

    state.forEach((vs, i) => {
      vs.timer = 50;
      const angle = Math.random() * Math.PI * 2;
      const magnitude = Math.random() * 0.25 + 0.15;
      vs.offset.set(
        Math.cos(angle) * magnitude,
        (Math.random() - 0.5) * magnitude,
        Math.sin(angle) * magnitude
      );
      vs.velocity.copy(vs.offset).multiplyScalar(-0.015);
    });
  }, []);

  /**
   * Main animation loop
   */
  const animate = useCallback(() => {
    const sphere = sphereRef.current;
    const crosshair = crosshairRef.current;
    const composer = composerRef.current;
    const scene = sceneRef.current;
    const camera = cameraRef.current;
    const origPos = originalPositionsRef.current;
    const vertexState = vertexStateRef.current;
    const vertexFade = vertexFadeRef.current;
    const vertexColors = vertexColorsRef.current;
    const adjacency = adjacencyRef.current;

    if (
      !sphere ||
      !composer ||
      !scene ||
      !camera ||
      !origPos ||
      !vertexFade ||
      !vertexColors
    ) {
      animationIdRef.current = requestAnimationFrame(animate);
      return;
    }

    const geometry = sphere.geometry as THREE.SphereGeometry;
    const positions = geometry.attributes.position.array as Float32Array;
    const colors = geometry.attributes.color.array as Float32Array;
    const vertexCount = geometry.attributes.position.count;
    const time = Date.now() * 0.001;

    // Evolve vertex physics
    let totalDisplacement = 0;
    for (let i = 0; i < vertexCount; i++) {
      const vs = vertexState[i];
      if (vs.timer > 0) {
        vs.timer--;
      }

      // Physics
      vs.offset.add(vs.velocity);
      vs.velocity.multiplyScalar(0.94);
      const springForce = vs.offset.clone().multiplyScalar(-0.01);
      vs.velocity.add(springForce);

      // Update position
      const idx = i * 3;
      positions[idx] = origPos[idx] + vs.offset.x;
      positions[idx + 1] = origPos[idx + 1] + vs.offset.y;
      positions[idx + 2] = origPos[idx + 2] + vs.offset.z;

      totalDisplacement += vs.offset.length();
    }
    geometry.attributes.position.needsUpdate = true;

    // Update impulses
    const impulses = impulsesRef.current;
    for (let i = impulses.length - 1; i >= 0; i--) {
      const impulse = impulses[i];
      impulse.progress += impulse.speed;

      if (impulse.progress >= 1.0) {
        impulses.splice(i, 1);

        // Impact the blob
        const conn = connectionMapRef.current.get(impulse.participantId);
        if (conn) {
          const targetVertex = conn.vertexIndex;
          vertexFade[targetVertex] = Math.min(
            vertexFade[targetVertex] + 0.4,
            1
          );
          vertexColors[targetVertex] = impulse.color;

          adjacency[targetVertex]?.forEach((neighbor) => {
            vertexFade[neighbor] = Math.min(vertexFade[neighbor] + 0.3, 1);
            vertexColors[neighbor] = impulse.color;
          });
        }

        // Small chance to trigger full glitch
        if (Math.random() < 0.15) {
          triggerGlitch();
        }
      }
    }

    // Fade vertex colors (reuse Color objects to avoid GC)
    let hasActiveVertexFade = false;
    for (let i = 0; i < vertexCount; i++) {
      if (vertexFade[i] > 0) {
        hasActiveVertexFade = true;
        vertexFade[i] -= 0.015;
        if (vertexFade[i] < 0) vertexFade[i] = 0;

        // Extract RGB from stored hex color
        const hex = vertexColors[i];
        const r = ((hex >> 16) & 255) / 255;
        const g = ((hex >> 8) & 255) / 255;
        const b = (hex & 255) / 255;

        // Lerp from white to color based on fade
        const fade = vertexFade[i];
        colors[i * 3] = 1 - (1 - r) * fade;
        colors[i * 3 + 1] = 1 - (1 - g) * fade;
        colors[i * 3 + 2] = 1 - (1 - b) * fade;
      }
    }
    if (hasActiveVertexFade) {
      geometry.attributes.color.needsUpdate = true;
    }

    // Rotate sphere
    sphere.rotation.y += 0.002;
    if (crosshair) crosshair.rotation.y += 0.002;

    // Subtle idle breathing on the sphere (scaled by 1 + breath)
    const breathAmount =
      Math.sin(time * 0.8) * 0.02 + Math.sin(time * 1.3) * 0.01;
    sphere.scale.setScalar(1 + breathAmount + audioBloom * 0.1);

    // Update connection lines (iterate map directly for stable references)
    connectionMapRef.current.forEach((conn) => {
      // Floating motion
      const floatX = Math.sin(time * conn.speed + conn.phase) * 0.12;
      const floatY = Math.cos(time * conn.speed * 0.7 + conn.phase) * 0.12;
      const newX = conn.fixedPosition.x + floatX;
      const newY = conn.fixedPosition.y + floatY;
      const rotZ = Math.sin(time * 0.5 + conn.phase) * 0.08;

      // Update canvas mesh
      conn.canvasMesh.position.x = newX;
      conn.canvasMesh.position.y = newY;
      conn.canvasMesh.rotation.z = rotZ;

      // Update border mesh to match
      conn.borderMesh.position.x = newX;
      conn.borderMesh.position.y = newY;
      conn.borderMesh.rotation.z = rotZ;

      // Update label position to follow canvas
      conn.labelObject.position.x = newX;
      conn.labelObject.position.y = newY - 0.6; // Offset below canvas

      // Fade glow (optimized: no allocations, throttled DOM updates)
      if (conn.glowIntensity > 0) {
        const prevIntensity = conn.glowIntensity;
        conn.glowIntensity -= 0.02;
        if (conn.glowIntensity < 0) conn.glowIntensity = 0;

        // Calculate lerped color without allocations
        const hex = conn.glowColor;
        const r = ((hex >> 16) & 255) / 255;
        const g = ((hex >> 8) & 255) / 255;
        const b = (hex & 255) / 255;
        const intensity = conn.glowIntensity;

        // Lerp from white (1,1,1) to glow color
        conn.material.color.setRGB(
          1 - (1 - r) * intensity,
          1 - (1 - g) * intensity,
          1 - (1 - b) * intensity
        );
        conn.material.opacity = 0.4 + intensity * 0.6;

        // Also glow the border
        const borderMat = conn.borderMesh.material as THREE.LineBasicMaterial;
        borderMat.color.copy(conn.material.color);
        borderMat.opacity = 0.6 + intensity * 0.4;

        // Throttle DOM updates: only update when intensity crosses 0.1 thresholds
        const prevBucket = Math.floor(prevIntensity * 10);
        const currBucket = Math.floor(intensity * 10);
        if (prevBucket !== currBucket || intensity === 0) {
          conn.labelObject.element.style.opacity = String(
            0.8 + intensity * 0.2
          );
          conn.labelObject.element.style.transform = `scale(${
            1 + intensity * 0.15
          })`;
        }
      } else {
        // Only reset if material is not already white
        if (conn.material.opacity !== 0.4) {
          conn.material.color.setHex(0xffffff);
          conn.material.opacity = 0.4;
          const borderMat = conn.borderMesh.material as THREE.LineBasicMaterial;
          borderMat.color.setHex(0xffffff);
          borderMat.opacity = 0.6;
          conn.labelObject.element.style.opacity = "0.8";
          conn.labelObject.element.style.transform = "scale(1)";
        }
      }

      // Update line endpoint to follow sphere rotation
      const idx = conn.vertexIndex * 3;
      const vertexPos = new THREE.Vector3(
        positions[idx],
        positions[idx + 1],
        positions[idx + 2]
      );
      vertexPos.applyMatrix4(sphere.matrixWorld);

      const linePositions = conn.line.geometry.attributes.position
        .array as Float32Array;
      linePositions[0] = newX;
      linePositions[1] = newY;
      linePositions[2] = conn.canvasMesh.position.z;
      linePositions[3] = vertexPos.x;
      linePositions[4] = vertexPos.y;
      linePositions[5] = vertexPos.z;
      conn.line.geometry.attributes.position.needsUpdate = true;
    });

    composer.render();

    // Render labels
    const labelRenderer = labelRendererRef.current;
    if (labelRenderer) {
      labelRenderer.render(scene, camera);
    }

    animationIdRef.current = requestAnimationFrame(animate);
  }, [triggerGlitch]);

  // Initialize scene
  useEffect(() => {
    initScene();

    return () => {
      if (animationIdRef.current) {
        cancelAnimationFrame(animationIdRef.current);
      }
      if (rendererRef.current && containerRef.current) {
        containerRef.current.removeChild(rendererRef.current.domElement);
        rendererRef.current.dispose();
      }
      if (labelRendererRef.current && containerRef.current) {
        containerRef.current.removeChild(labelRendererRef.current.domElement);
      }
      composerRef.current = null;
      labelRendererRef.current = null;
    };
  }, [initScene]);

  // Update participants when they change
  useEffect(() => {
    updateParticipants();
  }, [updateParticipants]);

  // Start animation after scene is ready
  useEffect(() => {
    if (sceneRef.current && !animationIdRef.current) {
      animate();
    }
    return () => {
      if (animationIdRef.current) {
        cancelAnimationFrame(animationIdRef.current);
        animationIdRef.current = null;
      }
    };
  }, [animate]);

  // Handle triggered participants
  useEffect(() => {
    triggeredIds.forEach((id) => {
      if (!prevTriggeredRef.current.has(id)) {
        sendImpulse(id);
      }
    });
    prevTriggeredRef.current = new Set(triggeredIds);
  }, [triggeredIds, sendImpulse]);

  // Handle resize
  useEffect(() => {
    const handleResize = () => {
      if (!containerRef.current || !cameraRef.current || !rendererRef.current)
        return;
      const width = containerRef.current.clientWidth;
      const height = containerRef.current.clientHeight;
      cameraRef.current.aspect = width / height;
      cameraRef.current.updateProjectionMatrix();
      rendererRef.current.setSize(width, height);
      composerRef.current?.setSize(width, height);
      labelRendererRef.current?.setSize(width, height);
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  return (
    <div
      ref={containerRef}
      className="absolute inset-0"
      style={{ background: "transparent" }}
    />
  );
}
