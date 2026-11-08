import { createBrowserRouter } from "react-router";
import { CrashFallback } from "./ErrorBoundary";
import { RequireRole } from "./guards";
import { BillingPage } from "../pages/Billing";
import { CustomerPage } from "../pages/Customer";
import { DashboardPage } from "../pages/Dashboard";
import { LoginPage } from "../pages/Login";
import { NotAuthorisedPage } from "../pages/NotAuthorised";
import { NotFoundPage } from "../pages/NotFound";
import { ReportDetailPage } from "../pages/ReportDetail";
import { ReportsPage } from "../pages/Reports";
import { SettingsPage } from "../pages/Settings";

export const router = createBrowserRouter([
  {
    errorElement: <CrashFallback />,
    children: [
      { path: "/login", element: <LoginPage /> },
      { path: "/not-authorised", element: <NotAuthorisedPage /> },
      {
        element: <RequireRole role="manager" />,
        children: [
          { path: "/", element: <DashboardPage /> },
          { path: "/reports", element: <ReportsPage /> },
          { path: "/reports/:reportId", element: <ReportDetailPage /> },
          { path: "/customers/:customerId", element: <CustomerPage /> },
          { path: "/billing", element: <BillingPage /> },
        ],
      },
      {
        element: <RequireRole role="admin" />,
        children: [{ path: "/settings", element: <SettingsPage /> }],
      },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
]);
