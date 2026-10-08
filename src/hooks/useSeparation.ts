import { useCallback, useEffect, useRef, useState } from "react";
import { cancelSeparation, separate, toAppError } from "../lib/tauri";
import type { AppError, LibraryItem, SeparationEvent, SeparationRequest, SeparationStage } from "../types";

export interface SeparationProgress {
  percent: number;
  stage: SeparationStage | null;
  device: string | null;
  deviceName: string | null;
  logs: string[];
  startedAt: number;
}

export type SeparationJob =
  | { phase: "idle" }
  | { phase: "running"; file: string; request: SeparationRequest; progress: SeparationProgress }
  | { phase: "error"; file: string; request: SeparationRequest; error: AppError };

const MAX_LOGS = 60;

function reduce(progress: SeparationProgress, event: SeparationEvent): SeparationProgress {
  switch (event.event) {
    case "progress":
      return { ...progress, percent: event.data.percent, stage: event.data.stage };
    case "device":
      return { ...progress, device: event.data.device, deviceName: event.data.name };
    case "log":
      return { ...progress, logs: [...progress.logs, event.data.message].slice(-MAX_LOGS) };
  }
}

/** Una separación a la vez: progreso en vivo y, al terminar, la nueva entrada de la biblioteca. */
export function useSeparation(onDone: (item: LibraryItem) => void) {
  const [job, setJob] = useState<SeparationJob>({ phase: "idle" });
  const runId = useRef(0);
  const onDoneRef = useRef(onDone);
  useEffect(() => {
    onDoneRef.current = onDone;
  });

  const start = useCallback(async (file: string, request: SeparationRequest) => {
    const id = ++runId.current;
    const progress: SeparationProgress = {
      percent: 0,
      stage: null,
      device: null,
      deviceName: null,
      logs: [],
      startedAt: Date.now(),
    };
    setJob({ phase: "running", file, request, progress });

    try {
      const item = await separate(file, request, (event) => {
        if (runId.current !== id) return;
        setJob((current) =>
          current.phase === "running" ? { ...current, progress: reduce(current.progress, event) } : current,
        );
      });
      if (runId.current !== id) return;
      setJob({ phase: "idle" });
      onDoneRef.current(item);
    } catch (raw) {
      if (runId.current !== id) return;
      const error = toAppError(raw);
      setJob(error.kind === "cancelled" ? { phase: "idle" } : { phase: "error", file, request, error });
    }
  }, []);

  const cancel = useCallback(() => {
    void cancelSeparation();
  }, []);

  const dismiss = useCallback(() => {
    runId.current++;
    setJob({ phase: "idle" });
  }, []);

  return { job, start, cancel, dismiss };
}
