import { useCallback, useEffect, useRef, useState } from "react";
import { engineSetupCancel, engineSetupPlan, engineSetupStart, toAppError } from "../lib/tauri";
import type { EngineStatus, EngineVariant, SetupPlan, SetupStep } from "../types";

export type SetupState =
  | { phase: "idle" }
  | {
      phase: "running";
      /** Poner al día un motor ya instalado (lo lanza la app sola), no instalarlo de cero. */
      update: boolean;
      step: SetupStep;
      percent: number;
      bytes: number | null;
      total: number | null;
      cancelling: boolean;
    }
  | { phase: "error"; message: string; cancelled: boolean };

/**
 * Motor integrado: lo que detecta el backend del equipo (`plan`) y su instalación.
 * Si el motor ya estaba instalado pero esta versión de la app necesita otro, la puesta al día
 * empieza sola: el usuario ya aceptó la descarga la primera vez y uv solo baja lo que cambió.
 */
export function useEngineSetup(status: EngineStatus | null, onStatus: (status: EngineStatus) => void) {
  const [plan, setPlan] = useState<SetupPlan | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  const [state, setState] = useState<SetupState>({ phase: "idle" });
  const autoUpdated = useRef(false);

  const loadPlan = useCallback(async () => {
    try {
      setPlan(await engineSetupPlan());
      setPlanError(null);
    } catch (raw) {
      setPlanError(toAppError(raw).message);
    }
  }, []);

  const needsSetup = status?.needsSetup ?? false;
  const integrated = status?.kind === "app";
  useEffect(() => {
    if (needsSetup || integrated) void loadPlan();
  }, [needsSetup, integrated, loadPlan]);

  const start = useCallback(
    async (variant: EngineVariant, update = false) => {
      setState({ phase: "running", update, step: "python", percent: 0, bytes: null, total: null, cancelling: false });
      try {
        const next = await engineSetupStart(variant, (event) => {
          setState((current) => {
            if (current.phase !== "running") return current;
            if (event.event === "step") return { ...current, step: event.data.step, bytes: null, total: null };
            if (event.event === "progress") {
              return { ...current, percent: event.data.percent, bytes: event.data.bytes, total: event.data.total };
            }
            return current;
          });
        });
        onStatus(next);
        setState({ phase: "idle" });
      } catch (raw) {
        const error = toAppError(raw);
        setState({ phase: "error", message: error.message, cancelled: error.kind === "cancelled" });
      }
      void loadPlan();
    },
    [loadPlan, onStatus],
  );

  const cancel = useCallback(() => {
    setState((current) => (current.phase === "running" ? { ...current, cancelling: true } : current));
    void engineSetupCancel();
  }, []);

  useEffect(() => {
    if (!needsSetup || !plan?.installed || plan.upToDate || autoUpdated.current || state.phase !== "idle") return;
    autoUpdated.current = true;
    void start(plan.installed.variant, true);
  }, [needsSetup, plan, state.phase, start]);

  return { plan, planError, state, start, cancel };
}

/** Variante con la que instalar: la del equipo, o la ya instalada si solo hay que ponerla al día. */
export function setupVariant(plan: SetupPlan): EngineVariant | null {
  if (plan.installed && !plan.upToDate) return plan.installed.variant;
  return plan.variant;
}
