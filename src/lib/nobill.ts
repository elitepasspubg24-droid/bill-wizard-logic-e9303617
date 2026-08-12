/**
 * "No Bill" mode.
 *
 * Every rate stored in the DB is a BILL rate. When a customer doesn't want a
 * bill, a variable percentage (usually 9-13%) is added on top of the basic
 * rate — and it can differ per factory.
 *
 * This is a *display* mode (like dark/light): flipping it on marks every
 * computed rate up, flipping it off restores the original bill rates. Nothing
 * in the database is changed. Settings live in localStorage so the toggle
 * survives reloads and works offline.
 */

const KEY = "mbs-nobill-v1";

export type NoBillState = {
  enabled: boolean;
  /** default % used when a factory has no override */
  defaultPct: number;
  /** factory_id -> % override */
  perFactory: Record<string, number>;
};

const initial: NoBillState = { enabled: false, defaultPct: 10, perFactory: {} };

function read(): NoBillState {
  if (typeof window === "undefined") return initial;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return initial;
    const parsed = JSON.parse(raw);
    return {
      enabled: !!parsed.enabled,
      defaultPct: Number(parsed.defaultPct) || 0,
      perFactory: parsed.perFactory && typeof parsed.perFactory === "object" ? parsed.perFactory : {},
    };
  } catch {
    return initial;
  }
}

let state: NoBillState = read();
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export function getNoBillState() {
  return state;
}

export function setNoBillState(patch: Partial<NoBillState>) {
  state = { ...state, ...patch };
  try {
    window.localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* storage unavailable — keep in memory */
  }
  emit();
}

export function toggleNoBill() {
  setNoBillState({ enabled: !state.enabled });
  return state.enabled;
}

export function setFactoryPct(factoryId: string, pct: number | null) {
  const next = { ...state.perFactory };
  if (pct === null || isNaN(pct)) delete next[factoryId];
  else next[factoryId] = pct;
  setNoBillState({ perFactory: next });
}

export function subscribeNoBill(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Percentage that applies to a factory (override, else default). */
export function pctFor(s: NoBillState, factoryId?: string | null) {
  if (factoryId && s.perFactory[factoryId] !== undefined) return Number(s.perFactory[factoryId]) || 0;
  return Number(s.defaultPct) || 0;
}

/** Applies the markup to a value when the mode is on. */
export function applyNoBill(s: NoBillState, value: number, factoryId?: string | null) {
  if (!s.enabled) return value;
  const pct = pctFor(s, factoryId);
  if (!pct) return value;
  return Math.round(value * (1 + pct / 100));
}
