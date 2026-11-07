import { createBrowserRouter } from "react-router";
import { CrashFallback } from "./ErrorBoundary";
import { RequireManager } from "./guards";
import { BillingPage } from "../pages/Billing";
import { DashboardPage } from "../pages/Dashboard";
import { LoginPage } from "../pages/Login";
import { NotAuthorisedPage } from "../pages/NotAuthorised";
import { NotFoundPage } from "../pages/NotFound";
import { ReportDetailPage } from "../pages/ReportDetail";
import { ReportsPage } from "../pages/Reports";

export const router = createBrowserRouter([
  {
    errorElement: <CrashFallback />,
    children: [
      { path: "/login", element: <LoginPage /> },
      { path: "/not-authorised", element: <NotAuthorisedPage /> },
      {
        element: <RequireManager />,
        children: [
          { path: "/", element: <DashboardPage /> },
          { path: "/reports", element: <ReportsPage /> },
          { path: "/reports/:reportId", element: <ReportDetailPage /> },
          { path: "/billing", element: <BillingPage /> },
        ],
      },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
]);
