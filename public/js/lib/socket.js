// Thin wrapper around the realtime protocol (docs/protocol.md).
import { io } from "/socket.io/socket.io.esm.min.js";

export function connect() {
  return io();
}

// Sends `event` and resolves with the server's reply. Never rejects: a
// timeout or lost connection resolves to { ok: false, error: "timeout" }.
export async function request(socket, event, payload, timeoutMs = 8000) {
  try {
    return await socket.timeout(timeoutMs).emitWithAck(event, payload);
  } catch {
    return { ok: false, error: "timeout" };
  }
}
