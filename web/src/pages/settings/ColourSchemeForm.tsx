import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  ApiError,
  DEFAULT_THEME,
  PRESETS,
  formatRatio,
  meetsAA,
  normaliseHex,
  useUpdateAdminSettings,
  weakestContrast,
  type AdminSettings,
} from "@jobproof/shared";
import { ThemePreview } from "./ThemePreview";

type Which = "primary" | "accent";

interface Check {
  hex: string | null;
  ok: boolean;
  message: string;
}

const BACKGROUND_NAMES = { white: "white", surface: "the surface colour" } as const;

/** Both colours carry text on white and on the surface colour: the lower ratio is the one shown. */
function check(raw: string, surface: string): Check {
  const hex = normaliseHex(raw);
  if (hex === null) return { hex: null, ok: false, message: "Use a colour in the form #RRGGBB." };
  const { ratio, background } = weakestContrast(hex, surface);
  const where = `${formatRatio(ratio)}:1 against ${BACKGROUND_NAMES[background]}`;
  return meetsAA(ratio)
    ? { hex, ok: true, message: `${where}, passes` }
    : { hex, ok: false, message: `${where}, needs 4.5:1` };
}

function ResetDialog({ open, onConfirm, onCancel }: { open: boolean; onConfirm: () => void; onCancel: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
    } else if (!open && dialog.open) {
      if (typeof dialog.close === "function") dialog.close();
      else dialog.removeAttribute("open");
    }
  }, [open]);
  return (
    <dialog ref={ref} className="confirm" aria-labelledby="reset-title" onCancel={onCancel} data-testid="reset-dialog">
      <h2 id="reset-title">Reset colours to the default green?</h2>
      <p>The colour fields are filled with the default green. Nothing changes until you press Save.</p>
      <div className="form-actions">
        <button type="button" className="btn btn-primary" data-testid="reset-confirm" onClick={onConfirm}>
          Reset colours
        </button>
        <button type="button" className="btn" data-testid="reset-cancel" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </dialog>
  );
}

export function ColourSchemeForm({ settings }: { settings: AdminSettings }) {
  const [values, setValues] = useState({ primary: settings.theme.primary, accent: settings.theme.accent });
  // The preview keeps the last pair that was valid while an input is being typed or invalid.
  const [preview, setPreview] = useState({ primary: settings.theme.primary, accent: settings.theme.accent });
  const [saved, setSaved] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const update = useUpdateAdminSettings();

  const surface = settings.theme.surface;
  const checks = { primary: check(values.primary, surface), accent: check(values.accent, surface) };
  const valid = checks.primary.ok && checks.accent.ok;
  const unchanged =
    checks.primary.hex === settings.theme.primary && checks.accent.hex === settings.theme.accent;
  const serverErrors: Partial<Record<Which, string>> = {};
  if (update.error instanceof ApiError && update.error.status === 422) {
    for (const e of update.error.fieldErrors) {
      const field = e.loc[e.loc.length - 1];
      if (field === "primary" || field === "accent") serverErrors[field] = e.message;
    }
  }
  const failure = update.isError && Object.keys(serverErrors).length === 0 ? update.error : undefined;

  function set(next: { primary: string; accent: string }) {
    setValues(next);
    setSaved(false);
    update.reset();
    const [p, a] = [check(next.primary, surface), check(next.accent, surface)];
    if (p.ok && a.ok) setPreview({ primary: p.hex!, accent: a.hex! });
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!valid || unchanged || update.isPending) return;
    setSaved(false);
    update.mutate(
      { theme: { primary: checks.primary.hex!, accent: checks.accent.hex! } },
      {
        onSuccess: (data) => {
          const next = { primary: data.theme.primary, accent: data.theme.accent };
          setValues(next);
          setPreview(next);
          setSaved(true);
        },
      },
    );
  }

  const selected = PRESETS.find(
    (p) => p.primary === checks.primary.hex && p.accent === checks.accent.hex,
  )?.id;

  function field(which: Which, label: string) {
    const c = checks[which];
    const message = serverErrors[which] ?? c.message;
    const bad = !c.ok || serverErrors[which] !== undefined;
    return (
      <div className="field">
        <label htmlFor={`colour-${which}`}>{label}</label>
        <div className="colour-row">
          <input
            id={`colour-${which}`}
            data-testid={`colour-${which}-input`}
            className="colour-text"
            value={values[which]}
            spellCheck={false}
            autoComplete="off"
            aria-invalid={bad ? "true" : undefined}
            aria-describedby={`colour-${which}-ratio`}
            onChange={(e) => set({ ...values, [which]: e.target.value })}
          />
          <input
            type="color"
            className="colour-picker"
            aria-label={`Pick the ${which} colour`}
            value={(c.hex ?? preview[which]).toLowerCase()}
            onChange={(e) => set({ ...values, [which]: normaliseHex(e.target.value) ?? e.target.value })}
          />
        </div>
        <span
          id={`colour-${which}-ratio`}
          className={bad ? "field-error" : "field-ok"}
          data-testid={`colour-${which}-ratio`}
        >
          {message}
        </span>
      </div>
    );
  }

  return (
    <section className="panel" aria-labelledby="colour-heading" data-testid="colour-section">
      <h2 id="colour-heading">Colour scheme</h2>
      <p className="muted small">
        Colours must have at least 4.5:1 contrast against both white and the surface colour (cards, table rows and highlights) so the text on them stays readable.
      </p>
      <form className="form settings-form" onSubmit={submit} noValidate>
        <fieldset className="presets">
          <legend>Presets</legend>
          <div className="preset-list">
            {PRESETS.map((p) => (
              <label key={p.id} className="preset" data-selected={selected === p.id ? "true" : "false"}>
                <input
                  type="radio"
                  name="preset"
                  value={p.id}
                  data-testid={`preset-${p.id}`}
                  checked={selected === p.id}
                  onChange={() => set({ primary: p.primary, accent: p.accent })}
                />
                <span className="preset-name">{p.name}</span>
                <span className="preset-swatches" aria-hidden="true">
                  <span className="swatch" style={{ background: p.primary }} />
                  <span className="swatch" style={{ background: p.accent }} />
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="colour-grid">
          {field("primary", "Primary colour (header and buttons)")}
          {field("accent", "Accent colour (links and focus)")}
        </div>

        <ThemePreview primary={preview.primary} accent={preview.accent} />

        <div className="form-actions">
          <button
            type="submit"
            className="btn btn-primary"
            data-testid="colour-save"
            disabled={!valid || unchanged || update.isPending}
          >
            {update.isPending ? "Saving..." : "Save colours"}
          </button>
          <button type="button" className="btn" data-testid="colour-reset" onClick={() => setConfirming(true)}>
            Reset to default
          </button>
          {saved && !update.isPending && (
            <span role="status" className="saved" data-testid="colour-saved">
              Settings saved
            </span>
          )}
        </div>
        {failure && (
          <div className="alert" role="alert" data-testid="colour-failure">
            Could not save the colours.{" "}
            {failure instanceof ApiError && failure.status === 0 ? "Can't reach the server." : "Something went wrong."}{" "}
            <button type="submit" className="btn btn-small" disabled={update.isPending}>
              Try again
            </button>
          </div>
        )}
      </form>
      <ResetDialog
        open={confirming}
        onCancel={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false);
          set({ primary: DEFAULT_THEME.primary, accent: DEFAULT_THEME.accent });
        }}
      />
    </section>
  );
}
