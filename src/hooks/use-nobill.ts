import { useSyncExternalStore } from "react";
import {
  applyNoBill,
  getNoBillState,
  pctFor,
  subscribeNoBill,
  type NoBillState,
} from "@/lib/nobill";

export function useNoBill() {
  const state = useSyncExternalStore<NoBillState>(
    (cb) => subscribeNoBill(cb),
    getNoBillState,
    getNoBillState,
  );

  return {
    ...state,
    /** marks a rate up when No Bill mode is on */
    adj: (value: number, factoryId?: string | null) => applyNoBill(state, value, factoryId),
    pctFor: (factoryId?: string | null) => pctFor(state, factoryId),
  };
}
