import { useCallback, useEffect, useRef, useState } from "react";
import type { ValidationResult } from "@jobproof/shared";

export const AUTOSAVE_MS = 500;

/**
 * Free text that saves itself (T-003f scenarios 7, 8, 11): the typed text is what the field shows;
 * 500 ms after the last keystroke the validated value is committed to the phone's database. There
 * is no Save button. Text that fails validation is refused with its message and is NOT altered
 * or lost while the screen is open; the last valid value stays saved. Leaving the screen saves
 * what is pending.
 */
export function useAutosave({
  stored,
  validate,
  commit,
  delayMs = AUTOSAVE_MS,
}: {
  stored: string | null;
  validate: (raw: string) => ValidationResult;
  commit: (value: string | null) => void;
  delayMs?: number;
}) {
  const [text, setText] = useState(stored ?? "");
  const [error, setError] = useState<string | undefined>();
  const pending = useRef<string | undefined>(undefined);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const latest = useRef({ validate, commit });
  useEffect(() => {
    latest.current = { validate, commit };
  });

  const flush = useCallback(() => {
    if (timer.current !== undefined) clearTimeout(timer.current);
    timer.current = undefined;
    const raw = pending.current;
    if (raw === undefined) return;
    pending.current = undefined;
    const result = latest.current.validate(raw);
    if (!result.ok) return;
    try {
      latest.current.commit(result.value);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save that. Try again.");
    }
  }, []);

  const onChange = useCallback(
    (raw: string) => {
      setText(raw);
      if (timer.current !== undefined) clearTimeout(timer.current);
      timer.current = undefined;
      const result = latest.current.validate(raw);
      if (!result.ok) {
        pending.current = undefined; // never save a refused text; the field keeps what was typed
        setError(result.message);
        return;
      }
      setError(undefined);
      pending.current = raw;
      timer.current = setTimeout(flush, delayMs);
    },
    [delayMs, flush],
  );

  // Leaving the screen (or the app being torn down) saves what is waiting.
  useEffect(() => flush, [flush]);

  return { text, error, onChange, flush };
}
