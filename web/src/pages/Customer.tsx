import { useState } from "react";
import { Link, useLocation, useParams } from "react-router";
import { ApiError, useCustomer, useFetchLatestCustomer } from "@jobproof/shared";
import { QueryBoundary } from "../components/QueryBoundary";
import { PageHeader, useDocumentTitle } from "../components/ui";
import { CustomerDetails, CustomerReports } from "./customer/CustomerDetails";
import { CustomerHistory } from "./customer/CustomerHistory";
import { EditCustomerForm } from "./customer/EditCustomerForm";

/** Keyed by customer id, so edit mode never carries over to another customer. */
export function CustomerPage() {
  const { customerId = "" } = useParams();
  return <CustomerView key={customerId} customerId={customerId} />;
}

function CustomerView({ customerId }: { customerId: string }) {
  const location = useLocation();
  // Reached from a report: the back link returns to it.
  const routeState = location.state as { from?: string; edit?: boolean } | null;
  const from = routeState?.from;
  const query = useCustomer(customerId);
  const data = query.data;
  const fetchLatest = useFetchLatestCustomer(customerId);
  // "Edit customer details" on a report opens the page already in edit mode.
  const [editing, setEditing] = useState(routeState?.edit === true);
  const [formKey, setFormKey] = useState(0);
  const [saved, setSaved] = useState(false);
  useDocumentTitle(data ? `Customer ${data.name}` : "Customer");

  const notFound = query.error instanceof ApiError && (query.error.status === 404 || query.error.status === 422);
  const back = from?.startsWith("/reports/") ? (
    <Link to={from} className="back-link" data-testid="back-link">
      <span aria-hidden="true">←</span> Back to report
    </Link>
  ) : (
    <Link to="/reports" className="back-link" data-testid="back-link">
      <span aria-hidden="true">←</span> Reports
    </Link>
  );

  if (notFound) {
    return (
      <>
        {back}
        <PageHeader title="Customer not found">There is no customer with this address.</PageHeader>
        <div className="state" data-testid="not-found">
          <Link className="btn btn-primary" to="/reports">
            Back to reports
          </Link>
        </div>
      </>
    );
  }

  return (
    <>
      {back}
      <PageHeader
        title={data ? data.name : "Customer"}
        actions={
          data &&
          !editing && (
            <div className="header-actions">
              <button
                type="button"
                className="btn"
                data-testid="edit-customer"
                onClick={() => {
                  setSaved(false);
                  setEditing(true);
                }}
              >
                Edit details
              </button>
            </div>
          )
        }
      />
      {/* Always rendered, so a screen reader announces the text when it appears. */}
      <p role="status" className={saved ? "saved page-saved" : "sr-only"} data-testid="edit-saved">
        {saved ? "Changes saved" : ""}
      </p>
      <QueryBoundary query={query} what="this customer" skeletonRows={6}>
        {(c) => (
          <div className="detail-grid">
            {editing ? (
              <EditCustomerForm
                key={formKey}
                customer={c}
                onSaved={(refetch) => {
                  setEditing(false);
                  setSaved(true);
                  if (refetch) void fetchLatest().catch(() => undefined);
                }}
                onClose={() => setEditing(false)}
                onReload={async () => {
                  await fetchLatest();
                  setFormKey((k) => k + 1);
                }}
              />
            ) : (
              <CustomerDetails customer={c} />
            )}
            <CustomerReports customerId={c.id} />
            <CustomerHistory customerId={c.id} />
          </div>
        )}
      </QueryBoundary>
    </>
  );
}
