import { useEffect } from "react";
import { useBlocker } from "react-router";

/**
 * While `dirty`, in-app navigation is blocked (the caller shows a "Leave without saving?" dialog from
 * the returned blocker) and closing or reloading the tab triggers the browser's own prompt.
 */
export function useUnsavedChangesGuard(dirty: boolean) {
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      dirty &&
      (currentLocation.pathname !== nextLocation.pathname || currentLocation.search !== nextLocation.search),
  );

  useEffect(() => {
    if (!dirty) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Some browsers still require a return value to show the prompt.
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  return blocker;
}
