import { useState, type FormEvent } from "react";
import { ApiError, useUpdateAdminSettings, type AdminSettings } from "@jobproof/shared";

/** The "UK customers only" setting (T-002p): how customer postcodes and phone numbers are checked. */
export function ContactRulesForm({ settings }: { settings: AdminSettings }) {
  const [value, setValue] = useState(settings.uk_only_contact_details);
  const [saved, setSaved] = useState(false);
  const update = useUpdateAdminSettings();

  const unchanged = value === settings.uk_only_contact_details;
  const server =
    update.error instanceof ApiError && update.error.status === 422
      ? (update.error.fieldErrors.find((e) => e.loc.includes("uk_only_contact_details"))?.message ?? "Send true or false.")
      : undefined;
  const forbidden = update.error instanceof ApiError && update.error.status === 403;
  const failure = update.isError && !server && !forbidden ? update.error : undefined;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (unchanged || update.isPending) return;
    setSaved(false);
    update.mutate(
      { uk_only_contact_details: value },
      {
        onSuccess: (data) => {
          setValue(data.uk_only_contact_details);
          setSaved(true);
        },
      },
    );
  }

  return (
    <section className="panel" aria-labelledby="contact-heading" data-testid="contact-section">
      <h2 id="contact-heading">Customer details</h2>
      <p className="muted small">How customer phone numbers and postcodes are checked when a manager edits them.</p>
      <form className="form settings-form" onSubmit={submit} noValidate>
        <div className="switch-row">
          <input
            id="uk-only"
            type="checkbox"
            role="switch"
            data-testid="uk-only-switch"
            checked={value}
            aria-describedby={`uk-only-help${server ? " uk-only-error" : ""}`}
            aria-invalid={server ? "true" : undefined}
            onChange={(e) => {
              setValue(e.target.checked);
              setSaved(false);
              update.reset();
            }}
          />
          <div>
            <label htmlFor="uk-only">UK customers only</label>
            <p className="muted small" id="uk-only-help" data-testid="uk-only-help">
              Customer postcodes and phone numbers must be UK ones. Turn off to allow other countries.
            </p>
          </div>
        </div>
        {server && (
          <p id="uk-only-error" className="field-error" data-testid="uk-only-error">
            {server}
          </p>
        )}
        <div className="form-actions">
          <button type="submit" className="btn btn-primary" data-testid="uk-only-save" disabled={unchanged || update.isPending}>
            {update.isPending ? "Saving..." : "Save customer details setting"}
          </button>
          {saved && !update.isPending && (
            <span role="status" className="saved" data-testid="uk-only-saved">
              Settings saved
            </span>
          )}
        </div>
        {forbidden && (
          <div className="alert" role="alert" data-testid="uk-only-forbidden">
            You no longer have permission to change settings.
          </div>
        )}
        {failure && (
          <div className="alert" role="alert" data-testid="uk-only-failure">
            Could not save the setting. {failure instanceof ApiError && failure.status === 0 ? "Can't reach the server." : "Something went wrong."}{" "}
            <button type="submit" className="btn btn-small" disabled={update.isPending}>
              Try again
            </button>
          </div>
        )}
      </form>
    </section>
  );
}
