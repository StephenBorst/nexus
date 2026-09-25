import { Helmet } from "react-helmet-async";
import { generatePageTitle } from "@/utils/utils";

// Tab title + description for the custom (non-Orderly) pages. The Orderly pages set theirs via
// renderSEOTags; this is the same Helmet, just smaller. A deeper <Helmet> (e.g. a trader or
// thesis detail page) overrides it, so a route-level PageMeta is a safe default.
export function PageMeta({ title, description, noindex = false }: { title: string; description?: string; noindex?: boolean }) {
  const full = generatePageTitle(title);
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
