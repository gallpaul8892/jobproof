/**
 * Three-way merge of a manager's edit form onto a newer saved version (T-002o, D11).
 *
 * base   = the version the manager loaded and started from
 * mine   = the form as the manager left it
 * theirs = the latest saved version
 *
 * It works on flat maps of field key to value, so one pure function serves the report and the
 * customer forms. Adapters (plain objects) flatten a form and put it back. Nothing here saves anything.
 */
export type FlatValue = string | boolean;
export type Flat = Record<string, FlatValue>;

export interface MergeAdapter<F> {
  /** Keys in display order. */
  flatten(form: F): Flat;
  /** A form shaped like `like`, holding the values in `flat`. */
  unflatten(flat: Flat, like: F): F;
  /** The value the server would store, so that "  " and null (or "bs1 4sb" and "BS1 4SB") compare equal. */
  normalise(key: string, value: FlatValue): FlatValue | null;
  label(key: string): string;
}

export interface Clash {
  key: string;
  label: string;
  mine: FlatValue;
  theirs: FlatValue;
}

export interface MergeResult<F> {
  /** The merged form. A clashing field holds the latest value until it is resolved. */
  form: F;
  /** Keys only this manager changed, re-applied on top of the latest version. */
  reapplied: string[];
  clashes: Clash[];
}

export type Choice = "mine" | "theirs";

export function mergeOnTop<F>(adapter: MergeAdapter<F>, base: F, mine: F, theirs: F): MergeResult<F> {
  const b = adapter.flatten(base);
  const m = adapter.flatten(mine);
  const t = adapter.flatten(theirs);
  const n = adapter.normalise;
  const out: Flat = {};
  const reapplied: string[] = [];
  const clashes: Clash[] = [];

  for (const key of Object.keys(t)) {
    const theirValue = t[key]!;
    // A key the manager never had (not possible today) simply takes the latest value.
    if (!(key in b) || !(key in m)) {
      out[key] = theirValue;
      continue;
    }
    const baseValue = b[key]!;
    const mineValue = m[key]!;
    if (n(key, mineValue) === n(key, baseValue)) {
      out[key] = theirValue; // the manager did not touch it
    } else if (n(key, theirValue) === n(key, baseValue)) {
      out[key] = mineValue; // only the manager changed it
      reapplied.push(key);
    } else if (n(key, theirValue) === n(key, mineValue)) {
      out[key] = theirValue; // both made the same change
    } else {
      out[key] = theirValue;
      clashes.push({ key, label: adapter.label(key), mine: mineValue, theirs: theirValue });
    }
  }
  return { form: adapter.unflatten(out, theirs), reapplied, clashes };
}

/** The form with each clash settled by `choices`; a clash without a choice keeps the latest value. */
export function resolve<F>(adapter: MergeAdapter<F>, result: MergeResult<F>, choices: Record<string, Choice>): F {
  const flat = adapter.flatten(result.form);
  for (const clash of result.clashes) {
    flat[clash.key] = choices[clash.key] === "mine" ? clash.mine : clash.theirs;
  }
  return adapter.unflatten(flat, result.form);
}
