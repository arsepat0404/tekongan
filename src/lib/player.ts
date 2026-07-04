// Local identity + gateway helpers (browser-only)
const GATE_KEY = "tekongan_gate_v1";
const GATE_CODE = "akusayangarsepat";
const PID_KEY = "tekongan_pid_v1";
const NAME_KEY = "tekongan_name_v1";

export function isAuthorized(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(GATE_KEY) === "1";
}
export function tryAuthorize(code: string): boolean {
  if (code.trim().toLowerCase() === GATE_CODE) {
    localStorage.setItem(GATE_KEY, "1");
    return true;
  }
  return false;
}
export function logout() {
  localStorage.removeItem(GATE_KEY);
}

export function getPlayerId(): string {
  if (typeof window === "undefined") return "";
  let id = localStorage.getItem(PID_KEY);
  if (!id) {
    id = "p_" + Math.random().toString(36).slice(2, 10);
    localStorage.setItem(PID_KEY, id);
  }
  return id;
}
export function getPlayerName(): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem(NAME_KEY) ?? "";
}
export function setPlayerName(n: string) {
  localStorage.setItem(NAME_KEY, n);
}

export function genRoomCode(): string {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 5; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

export function vibrate(pattern: number | number[]) {
  if (typeof navigator !== "undefined" && navigator.vibrate) {
    try { navigator.vibrate(pattern); } catch { /* ignore */ }
  }
}
