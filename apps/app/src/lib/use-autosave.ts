import { useCallback, useEffect, useRef, useState } from "react";

export type SaveState = "idle" | "pending" | "saving" | "saved" | "error";

/** Debounced, strictly sequential saves of the latest value; flushes on unmount. */
export function useAutosave<T>(save: (value: T) => Promise<unknown>, delay = 700) {
  const [state, setState] = useState<SaveState>("idle");
  const latest = useRef<{ value: T } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const inFlight = useRef<Promise<void>>(Promise.resolve());
  const saveRef = useRef(save);

  useEffect(() => {
    saveRef.current = save;
  });

  const flush = useCallback(() => {
    clearTimeout(timer.current);
    const next = latest.current;

    if (!next) return inFlight.current;

    latest.current = null;
    setState("saving");

    inFlight.current = inFlight.current.then(() =>
      saveRef.current(next.value).then(
        () => setState(latest.current ? "pending" : "saved"),
        () => setState("error"),
      ),
    );

    return inFlight.current;
  }, []);

  const schedule = useCallback(
    (value: T) => {
      latest.current = { value };
      setState("pending");
      clearTimeout(timer.current);
      timer.current = setTimeout(flush, delay);
    },
    [delay, flush],
  );

  const cancel = useCallback(() => {
    clearTimeout(timer.current);
    latest.current = null;
    setState((current) => (current === "pending" ? "idle" : current));
  }, []);

  useEffect(() => () => void flush(), [flush]);

  return { state, schedule, flush, cancel };
}
