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
  /** The stored value this field last showed or committed; a different one arriving is news from outside (a refetch, a restore). */
  const known = useRef<string | null>(stored);
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
      known.current = result.value;
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

  // A changed stored value (the server's copy after a sync, a restored snapshot) is adopted when the
  // operative has nothing pending or refused on screen; otherwise typing would replace it unseen.
  useEffect(() => {
    if (stored === known.current) return;
    if (pending.current !== undefined || timer.current !== undefined || error !== undefined) return;
    known.current = stored;
    setText(stored ?? "");
  }, [stored, error]);

  // Leaving the screen (or the app being torn down) saves what is waiting.
  useEffect(() => flush, [flush]);

  return { text, error, onChange, flush };
}
