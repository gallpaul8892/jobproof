import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "react-router/dom";
import { BrandingProvider } from "../theme/BrandingProvider";
import { ErrorBoundary } from "./ErrorBoundary";
import { queryClient } from "./queryClient";
import { router } from "./router";

export function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <BrandingProvider>
          <RouterProvider router={router} />
        </BrandingProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
