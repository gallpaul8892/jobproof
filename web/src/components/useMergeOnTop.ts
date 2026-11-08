import { useLayoutEffect, useRef, useState } from "react";
import {
  mergeOnTop,
  type Choice,
  type Clash,
  type MergeAdapter,
  type PersonRef,
} from "@jobproof/shared";

export interface MergeState {
  /** Bumped on every apply, so the form can move focus once per merge. */
  seq: number;
  by: PersonRef | null;
  at: string | null;
  reapplied: ReadonlySet<string>;
  clashes: Clash[];
  choices: Record<string, Choice>;
}

interface Latest {
  last_changed_by: PersonRef | null;
  last_changed_at: string | null;
}

/**
 * State for "Apply my changes on top" (T-002o), shared by the report and customer forms.
 *
 * The base is the record the form started from (`original`); it only changes here, when the latest
 * version is loaded, so the three-way merge is always against what the manager actually saw. Nothing
 * is saved: the merged form is shown and the manager clicks Save.
 */
export function useMergeOnTop<F, R extends Latest>({
  adapter,
  original,
  form,
  setForm,
  setOriginal,
  fetchLatest,
  toForm,
}: {
  adapter: MergeAdapter<F>;
  original: R;
  form: F;
  setForm: (form: F) => void;
  setOriginal: (record: R) => void;
  fetchLatest: () => Promise<R>;
  toForm: (record: R) => F;
}) {
  const [merge, setMerge] = useState<MergeState | null>(null);
  const [applying, setApplying] = useState(false);
  const [applyFailed, setApplyFailed] = useState(false);
  // The merge runs after an await, so it must read the form as it is then, not as it was at the click.
  const formRef = useRef(form);
  useLayoutEffect(() => {
    formRef.current = form;
  }, [form]);

  /** Resolves true when the merge was applied; on a failed load nothing at all changes. */
  async function apply(): Promise<boolean> {
    setApplying(true);
    setApplyFailed(false);
    let latest: R;
    try {
      latest = await fetchLatest();
    } catch {
      setApplyFailed(true);
      return false;
    } finally {
      setApplying(false);
    }
    const result = mergeOnTop(adapter, toForm(original), formRef.current, toForm(latest));
    formRef.current = result.form;
    setOriginal(latest);
    setForm(result.form);
    setMerge((previous) => ({
      seq: (previous?.seq ?? 0) + 1,
      by: latest.last_changed_by,
      at: latest.last_changed_at,
      reapplied: new Set(result.reapplied),
      clashes: result.clashes,
      choices: {},
    }));
    return true;
  }

  function choose(key: string, choice: Choice) {
    if (!merge) return;
    const clash = merge.clashes.find((c) => c.key === key);
    if (!clash) return;
    const flat = adapter.flatten(formRef.current);
    flat[key] = choice === "mine" ? clash.mine : clash.theirs;
    const next = adapter.unflatten(flat, formRef.current);
    formRef.current = next;
    setForm(next);
    setMerge({ ...merge, choices: { ...merge.choices, [key]: choice } });
  }

  /** Drops the merge display (notice, clash choices, Re-applied tags), e.g. when a new 409 arrives. */
  const clear = () => setMerge(null);

  const clashFor = (key: string) => merge?.clashes.find((c) => c.key === key);
  /** Every field is read-only while the latest version loads; a clashing field stays read-only until the manager picks a version. */
  const locked = (key: string) => applying || (clashFor(key) !== undefined && merge?.choices[key] === undefined);
  const unresolved = merge ? merge.clashes.filter((c) => merge.choices[c.key] === undefined).length : 0;

  return {
    merge,
    applying,
    applyFailed,
    apply,
    choose,
    clear,
    clashFor,
    locked,
    unresolved,
    reapplied: (key: string) => merge?.reapplied.has(key) ?? false,
  };
}
