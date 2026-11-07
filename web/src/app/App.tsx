import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createBrowserRouter } from "react-router";
import { RouterProvider } from "react-router/dom";
import { StatusPage } from "../pages/StatusPage";

export const queryClient = new QueryClient();

const router = createBrowserRouter([
  { path: "/", element: <StatusPage /> },
  { path: "*", element: <StatusPage /> },
]);

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}
