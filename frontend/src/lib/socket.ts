import { io, Socket } from "socket.io-client";

const DEFAULT_URL = "http://localhost:8000";
const SOCKET_PATH = "/ws/socket.io";

let socket: Socket | null = null;
let currentUrl: string | null = null;

/**
 * Returns a Socket.IO client instance.
 *
 * URL resolution order:
 * 1. Explicit serverUrl parameter
 * 2. ?server= query parameter in the URL
 * 3. NEXT_PUBLIC_SOCKET_URL environment variable
 * 4. Default: http://localhost:8000
 */
export function getSocket(serverUrl?: string): Socket {
  const url = resolveSocketUrl(serverUrl);

  // Return existing socket if URL matches
  if (socket && currentUrl === url) {
    return socket;
  }

  // Disconnect old socket if URL changed
  if (socket && currentUrl !== url) {
    socket.disconnect();
    socket = null;
  }

  currentUrl = url;
  socket = io(url, {
    path: SOCKET_PATH,
    transports: ["websocket"],
    autoConnect: true,
  });

  return socket;
}

function resolveSocketUrl(serverUrl?: string): string {
  if (serverUrl) return serverUrl;

  if (typeof window !== "undefined") {
    const params = new URLSearchParams(window.location.search);
    const serverParam = params.get("server");
    if (serverParam) return serverParam;
  }

  if (process.env.NEXT_PUBLIC_SOCKET_URL) {
    return process.env.NEXT_PUBLIC_SOCKET_URL;
  }

  return DEFAULT_URL;
}

/**
 * Disconnect and clear the socket instance.
 */
export function disconnectSocket(): void {
  if (socket) {
    socket.disconnect();
    socket = null;
    currentUrl = null;
  }
}
