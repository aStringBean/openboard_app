import { useSyncExternalStore } from "react";

import { getSessionState, subscribeSession, type SessionState } from "../lib/cloud";

export function useSession(): SessionState {
  return useSyncExternalStore(subscribeSession, getSessionState);
}
