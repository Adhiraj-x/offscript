import { coerceFillers } from "./fillers";
import { coerceSpeechMetrics } from "./speechMetrics";
import type { Session } from "./types";

const HISTORY_KEY = "offscript_history_v1";
const MAX_SESSIONS = 200;

function isSession(value: unknown): value is Session {
  if (!value || typeof value !== "object") return false;
  const s = value as Partial<Session>;
  return (
    typeof s.id === "string" &&
    typeof s.date === "string" &&
    typeof s.topic === "string" &&
    typeof s.feedback === "string" &&
    typeof s.transcript === "string" &&
    typeof s.overallScore === "number"
  );
}

/**
 * Legacy records predate the metric and filler fields. A malformed blob is dropped
 * rather than rendered, so an old or hand-edited session still opens.
 */
function toSession(value: unknown): Session | null {
  if (!isSession(value)) return null;
  const session = value as Session;
  const metrics = coerceSpeechMetrics((session as { metrics?: unknown }).metrics);
  const fillers = coerceFillers((session as { fillers?: unknown }).fillers);
  const mainTakeaway =
    typeof session.mainTakeaway === "string" && session.mainTakeaway.trim().length > 0
      ? session.mainTakeaway.trim()
      : undefined;
  const nextAttemptFocus =
    typeof session.nextAttemptFocus === "string" && session.nextAttemptFocus.trim().length > 0
      ? session.nextAttemptFocus.trim()
      : undefined;
  return {
    ...session,
    mainTakeaway,
    nextAttemptFocus,
    metrics: metrics ?? undefined,
    fillers: fillers ?? undefined,
  };
}

/** Reads history newest-first. Returns [] if storage is unavailable or corrupt. */
export function loadHistory(): Session[] {
  try {
    const raw = window.localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(toSession)
      .filter((session): session is Session => session !== null)
      .sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
  } catch {
    return [];
  }
}

/** Prepends a session; returns the session so callers can keep state in sync. */
export function saveSession(session: Session): Session {
  try {
    const existing = loadHistory().filter((s) => s.id !== session.id);
    const next = [session, ...existing].slice(0, MAX_SESSIONS);
    window.localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
  } catch {
    // Storage full or blocked (private mode): the app still works, it just forgets.
  }
  return session;
}

export function clearHistory(): void {
  try {
    window.localStorage.removeItem(HISTORY_KEY);
  } catch {
    // Nothing to do — storage is unavailable.
  }
}

export function newSessionId(): string {
  try {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
      return crypto.randomUUID();
    }
  } catch {
    // Fall through to the timestamp id.
  }
  return `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
