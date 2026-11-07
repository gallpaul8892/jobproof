import { useState, type FormEvent } from "react";
import {
  ApiError,
  COMPANY_NAME_MAX,
  nameLength,
  useUpdateAdminSettings,
  validateCompanyName,
  type AdminSettings,
} from "@jobproof/shared";

export function CompanyNameForm({ settings }: { settings: AdminSettings }) {
  const [value, setValue] = useState(settings.company_name);
  const [saved, setSaved] = useState(false);
  const update = useUpdateAdminSettings();

  const result = validateCompanyName(value);
  const unchanged = result.value === settings.company_name;
  const server =
    update.error instanceof ApiError && update.error.status === 422
      ? update.error.fieldErrors.find((e) => e.loc.includes("company_name"))?.message
      : undefined;
  const failure = update.isError && !server ? update.error : undefined;
  const error = result.error ?? server;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (result.value === undefined || unchanged || update.isPending) return;
    setSaved(false);
    update.mutate(
      { company_name: result.value },
      {
        onSuccess: (data) => {
          setValue(data.company_name);
          setSaved(true);
        },
      },
    );
  }

  return (
    <section className="panel" aria-labelledby="company-heading" data-testid="company-section">
      <h2 id="company-heading">Company</h2>
      <p className="muted small">Shown in the header, on the sign-in page and in the browser tab.</p>
      <form className="form settings-form" onSubmit={submit} noValidate>
        <div className="field">
          <label htmlFor="company-name">Company name</label>
          <input
            id="company-name"
            data-testid="company-name-input"
            value={value}
            autoComplete="off"
            aria-invalid={error ? "true" : undefined}
            aria-describedby={`company-count${error ? " company-error" : ""}`}
            onChange={(e) => {
              setValue(e.target.value);
              setSaved(false);
              update.reset();
            }}
          />
          <div className="field-meta">
            <span id="company-error" className="field-error" data-testid="company-name-error">
              {error}
            </span>
            <span id="company-count" className="muted small" data-testid="company-name-count">
              {nameLength(value)} / {COMPANY_NAME_MAX}
            </span>
          </div>
        </div>
        <div className="form-actions">
          <button
            type="submit"
            className="btn btn-primary"
            data-testid="company-name-save"
            disabled={result.value === undefined || unchanged || update.isPending}
          >
            {update.isPending ? "Saving..." : "Save company name"}
          </button>
          {saved && !update.isPending && (
            <span role="status" className="saved" data-testid="company-name-saved">
              Settings saved
            </span>
          )}
        </div>
        {failure && (
          <div className="alert" role="alert" data-testid="company-name-failure">
            Could not save the company name. {failure instanceof ApiError && failure.status === 0
              ? "Can't reach the server."
              : "Something went wrong."}{" "}
            <button type="submit" className="btn btn-small" disabled={update.isPending}>
              Try again
            </button>
          </div>
        )}
      </form>
    </section>
  );
}
