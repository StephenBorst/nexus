import { Helmet } from "react-helmet-async";
import { generatePageTitle } from "@/utils/utils";
import { routeMetaFor } from "@/lib/routeMeta.mjs";

// Tab title + description for the custom (non-Orderly) pages. The Orderly pages set theirs via
// renderSEOTags; this is the same Helmet, just smaller. A deeper <Helmet> (e.g. a trader or
// thesis detail page) overrides it, so a route-level PageMeta is a safe default.
// `route` = an indexed route: its title + description come from app/lib/routeMeta.mjs, the SAME copy
// the Pages Function writes into the HTML head for crawlers and link previews (one source).
export function PageMeta({ title, description, noindex = false, route }: { title?: string; description?: string; noindex?: boolean; route?: string }) {
  const rm = route ? routeMetaFor(route) : null;
  if (rm) description = rm.description;
  const full = rm ? rm.title : generatePageTitle(title || "");
  return (
    <Helmet>
      <title>{full}</title>
      <meta property="og:title" content={full} />
      {description && <meta name="description" content={description} />}
      {description && <meta property="og:description" content={description} />}
      {noindex && <meta name="robots" content="noindex" />}
    </Helmet>
  );
}

export default PageMeta;
