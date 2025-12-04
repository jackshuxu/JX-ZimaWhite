"use client";

type Props = {
  activations: number[] | undefined;
};

// Different 3D octahedron projections (varying view angles)
const SHAPE_CONFIGS = [
  { rotX: 0, rotY: 0, rotZ: 0 }, // 0 - front view
  { rotX: 25, rotY: 35, rotZ: 10 }, // 1 - tilted right
  { rotX: -20, rotY: -25, rotZ: 5 }, // 2 - tilted left
  { rotX: 40, rotY: 15, rotZ: -15 }, // 3 - looking down
  { rotX: -15, rotY: 45, rotZ: 20 }, // 4 - rotated
  { rotX: 30, rotY: -40, rotZ: -10 }, // 5 - angled
  { rotX: -35, rotY: 20, rotZ: 15 }, // 6 - looking up
  { rotX: 15, rotY: -15, rotZ: -25 }, // 7 - slight tilt
  { rotX: -10, rotY: 50, rotZ: 5 }, // 8 - side view
  { rotX: 45, rotY: -30, rotZ: 30 }, // 9 - dynamic
];

const SIZE = 24;
const CENTER = SIZE / 2;
const RADIUS = 9;

// 3D point rotation
function rotate3D(
  x: number,
  y: number,
  z: number,
  rotX: number,
  rotY: number,
  rotZ: number
) {
  // Convert to radians
  const rx = (rotX * Math.PI) / 180;
  const ry = (rotY * Math.PI) / 180;
  const rz = (rotZ * Math.PI) / 180;

  // Rotate around X
  let y1 = y * Math.cos(rx) - z * Math.sin(rx);
  let z1 = y * Math.sin(rx) + z * Math.cos(rx);

  // Rotate around Y
  let x2 = x * Math.cos(ry) + z1 * Math.sin(ry);
  let z2 = -x * Math.sin(ry) + z1 * Math.cos(ry);

  // Rotate around Z
  let x3 = x2 * Math.cos(rz) - y1 * Math.sin(rz);
  let y3 = x2 * Math.sin(rz) + y1 * Math.cos(rz);

  return { x: x3, y: y3, z: z2 };
}

// Project 3D to 2D
function project(point: { x: number; y: number; z: number }) {
  const scale = 1 / (1 + point.z * 0.05); // Simple perspective
  return {
    x: CENTER + point.x * scale,
    y: CENTER + point.y * scale,
    z: point.z,
  };
}

// Octahedron vertices (6 points)
const VERTICES_3D = [
  { x: 0, y: -RADIUS, z: 0 }, // 0: top
  { x: RADIUS, y: 0, z: 0 }, // 1: right
  { x: 0, y: 0, z: RADIUS }, // 2: front
  { x: -RADIUS, y: 0, z: 0 }, // 3: left
  { x: 0, y: 0, z: -RADIUS }, // 4: back
  { x: 0, y: RADIUS, z: 0 }, // 5: bottom
];

// Octahedron edges (12 edges)
const EDGES = [
  [0, 1],
  [0, 2],
  [0, 3],
  [0, 4], // top to middle
  [5, 1],
  [5, 2],
  [5, 3],
  [5, 4], // bottom to middle
  [1, 2],
  [2, 3],
  [3, 4],
  [4, 1], // middle ring
];

export function OutputVisualization({ activations }: Props) {
  const values = activations ?? Array(10).fill(0.1);

  return (
    <div className="flex items-center justify-between w-full py-2">
      {values.map((activation, i) => {
        const intensity = Math.max(0, Math.min(1, activation));
        const config = SHAPE_CONFIGS[i];

        const opacity = 0.15 + intensity * 0.85;
        const glowStrength = intensity * 14;
        const strokeWidth = 0.5 + intensity * 1.0;

        // Transform and project all vertices
        const vertices2D = VERTICES_3D.map((v) => {
          const rotated = rotate3D(
            v.x,
            v.y,
            v.z,
            config.rotX,
            config.rotY,
            config.rotZ
          );
          return project(rotated);
        });

        // Calculate edge visibility (front vs back based on average Z)
        const edgesWithDepth = EDGES.map(([a, b]) => {
          const avgZ = (vertices2D[a].z + vertices2D[b].z) / 2;
          return { a, b, avgZ, isFront: avgZ > 0 };
        });

        // Sort edges by depth (back to front)
        edgesWithDepth.sort((e1, e2) => e1.avgZ - e2.avgZ);

        return (
          <div key={i} className="flex flex-col items-center gap-1">
            <svg
              width={SIZE}
              height={SIZE}
              viewBox={`0 0 ${SIZE} ${SIZE}`}
              className="transition-all duration-150"
              style={{
                filter: `drop-shadow(0 0 ${glowStrength}px rgba(255, 255, 255, ${
                  intensity * 0.9
                }))`,
              }}
            >
              {/* Draw edges back to front */}
              {edgesWithDepth.map(({ a, b, isFront }, idx) => {
                const p1 = vertices2D[a];
                const p2 = vertices2D[b];
                return (
                  <line
                    key={idx}
                    x1={p1.x}
                    y1={p1.y}
                    x2={p2.x}
                    y2={p2.y}
                    stroke={`rgba(255, 255, 255, ${
                      isFront ? opacity : opacity * 0.35
                    })`}
                    strokeWidth={isFront ? strokeWidth : strokeWidth * 0.6}
                    strokeDasharray={isFront ? "none" : "1.5,1.5"}
                  />
                );
              })}

              {/* Draw vertices as small dots */}
              {vertices2D.map((v, idx) => (
                <circle
                  key={`v-${idx}`}
                  cx={v.x}
                  cy={v.y}
                  r={strokeWidth * 0.4}
                  fill={`rgba(255, 255, 255, ${
                    v.z > 0 ? opacity : opacity * 0.4
                  })`}
                />
              ))}
            </svg>
            {/* Digit label */}
            <span
              className="text-[10px] font-mono transition-all duration-150"
              style={{
                color: `rgba(255, 255, 255, ${0.3 + intensity * 0.7})`,
                textShadow:
                  intensity > 0.5
                    ? `0 0 ${glowStrength / 2}px rgba(255, 255, 255, ${
                        intensity * 0.5
                      })`
                    : "none",
              }}
            >
              {i}
            </span>
          </div>
        );
      })}
    </div>
  );
}
