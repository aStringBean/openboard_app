import { useEffect, useRef } from "react";
import { useFocusEffect } from "expo-router";

import { useApp } from "../state/AppProvider";

/**
 * Loads a screen's data when it comes into view — something may have
 * changed while it was hidden — and again whenever a sync brings in others'
 * changes while it is showing. `load` must be memoised, and may return a
 * cleanup that marks its result stale.
 */
export function useFocusReload(load: () => void | (() => void)): void {
  const { revision } = useApp();
  useFocusEffect(load);

  const seen = useRef(revision);
  useEffect(() => {
    if (seen.current === revision) return;
    seen.current = revision;
    return load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only a new revision should reload here
  }, [revision]);
}
