import { useEffect } from "react";
import { routeTitle, SITE_TITLE } from "@/lib/routeMeta.mjs";

/**
 * The browser-tab title for an indexed route, from the same source the server writes into the HTML
 * (app/lib/routeMeta.mjs). Restores the site name on leave, as the call and trader pages do. `null` = leave
 * the title alone (a page embedded inside another, e.g. Market Intel inside the Lab).
 */
export function usePageTitle(route: string | null): void {
  useEffect(() => {
    if (route == null) return;
    document.title = routeTitle(route);
    return () => { document.title = SITE_TITLE; };
  }, [route]);
}
