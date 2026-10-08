import { useCallback, useState } from "react";
import { loadPreferences, savePreferences, type Preferences } from "../lib/preferences";

export function usePreferences() {
  const [preferences, setPreferences] = useState<Preferences>(loadPreferences);

  const update = useCallback((change: Partial<Preferences>) => {
    setPreferences((current) => {
      const next = { ...current, ...change };
      savePreferences(next);
      return next;
    });
  }, []);

  return [preferences, update] as const;
}
