import { formatDateTime, useAdminSettings, type AdminSettings } from "@jobproof/shared";
import { QueryBoundary } from "../components/QueryBoundary";
import { PageHeader, useDocumentTitle } from "../components/ui";
import { ColourSchemeForm } from "./settings/ColourSchemeForm";
import { CompanyNameForm } from "./settings/CompanyNameForm";
import { ContactRulesForm } from "./settings/ContactRulesForm";

function LastChanged({ settings }: { settings: AdminSettings }) {
  if (!settings.updated_at || !settings.updated_by) {
    return (
      <p className="muted small" data-testid="last-changed">
        Not changed yet.
      </p>
    );
  }
  return (
    <p className="muted small" data-testid="last-changed">
      Last changed by {settings.updated_by.name} on {formatDateTime(settings.updated_at)}
    </p>
  );
}

export function SettingsPage() {
  useDocumentTitle("Settings");
  const query = useAdminSettings();
  return (
    <>
      <PageHeader title="Settings">The company name and colour scheme everyone in your company sees, and how customer details are checked.</PageHeader>
      <QueryBoundary query={query} what="the settings" skeletonRows={3}>
        {(settings) => (
          <div className="settings" data-testid="settings-page">
            <CompanyNameForm settings={settings} />
            <ColourSchemeForm settings={settings} />
            <ContactRulesForm settings={settings} />
            <LastChanged settings={settings} />
          </div>
        )}
      </QueryBoundary>
    </>
  );
}
