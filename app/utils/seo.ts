import { getRuntimeConfig, getRuntimeConfigArray } from "./runtime-config";

export interface SEOConfig {
  siteName?: string;
  siteDescription?: string;
  siteUrl?: string;
  language?: string;
  locale?: string;
  twitterHandle?: string;
  themeColor?: string;
  keywords?: string;
}

type MetaTag =
  | { title: string }
  | { name: string; content: string }
  | { property: string; content: string };

type LinkTag = {
  rel: string;
  href: string;
  hrefLang?: string;
};

const SUPPORTED_LANGUAGES = [
  { code: "en", name: "English", flag: "🇺🇸" },
  { code: "zh", name: "中文", flag: "🇨🇳" },
  { code: "ja", name: "日本語", flag: "🇯🇵" },
  { code: "es", name: "Español", flag: "🇪🇸" },
  { code: "ko", name: "한국어", flag: "🇰🇷" },
  { code: "vi", name: "Tiếng Việt", flag: "🇻🇳" },
  { code: "de", name: "Deutsch", flag: "🇩🇪" },
  { code: "fr", name: "Français", flag: "🇫🇷" },
  { code: "ru", name: "Русский", flag: "🇷🇺" },
  { code: "id", name: "Bahasa Indonesia", flag: "🇮🇩" },
  { code: "tr", name: "Türkçe", flag: "🇹🇷" },
  { code: "it", name: "Italiano", flag: "🇮🇹" },
  { code: "pt", name: "Português", flag: "🇵🇹" },
  { code: "uk", name: "Українська", flag: "🇺🇦" },
  { code: "pl", name: "Polski", flag: "🇵🇱" },
  { code: "nl", name: "Nederlands", flag: "🇳🇱" },
];

export function getUserLanguage(): string {
  if (typeof window !== "undefined") {
    const urlParams = new URLSearchParams(window.location.search);
    const langParam = urlParams.get("lang");
    if (langParam) {
      return langParam;
    }

    if (navigator.language) {
      return navigator.language.split("-")[0];
    }
  }
  return "en";
}

export function getSEOConfig(): SEOConfig {
  return {
    siteName: getRuntimeConfig("VITE_SEO_SITE_NAME"),
    siteDescription: getRuntimeConfig("VITE_SEO_SITE_DESCRIPTION"),
    siteUrl: getRuntimeConfig("VITE_SEO_SITE_URL"),
    language: getRuntimeConfig("VITE_SEO_SITE_LANGUAGE"),
    locale: getRuntimeConfig("VITE_SEO_SITE_LOCALE"),
    twitterHandle: getRuntimeConfig("VITE_SEO_TWITTER_HANDLE"),
    themeColor: getRuntimeConfig("VITE_SEO_THEME_COLOR"),
    keywords: getRuntimeConfig("VITE_SEO_KEYWORDS"),
  };
}

function getAvailableLanguages(): string[] {
  const languages = getRuntimeConfigArray("VITE_AVAILABLE_LANGUAGES");
  if (languages.length === 0) return ["en"];

  return languages
    .map((code: string) => code.trim())
    .filter((code: string) =>
      SUPPORTED_LANGUAGES.some((lang) => lang.code === code)
    );
}

function generateHrefLangLinks(path: string): LinkTag[] {
  const config = getSEOConfig();
  const siteUrl = config.siteUrl;

  if (!siteUrl) return [];

  const availableLanguages = getAvailableLanguages();
  const links: LinkTag[] = [];

  availableLanguages.forEach((langCode) => {
    const url = new URL(siteUrl);
    url.pathname = path;

    if (langCode !== "en") {
      url.searchParams.set("lang", langCode);
    }

    links.push({
      rel: "alternate",
      hrefLang: langCode,
      href: url.toString(),
    });
  });

  if (availableLanguages.length > 1) {
    const defaultUrl = new URL(siteUrl);
    defaultUrl.pathname = path;

    links.push({
      rel: "alternate",
      hrefLang: "x-default",
      href: defaultUrl.toString(),
    });
  }

  return links;
}

export function getPageMeta(): (MetaTag | LinkTag)[] {
  const config = getSEOConfig();
  const siteName = config.siteName;
  const siteDescription = config.siteDescription;
  const siteUrl = config.siteUrl;

  const fullTitle = siteName;
  const fullUrl = siteUrl || "";

  let metaImage;
  if (siteUrl) {
    const baseUrl = siteUrl.endsWith("/") ? siteUrl.slice(0, -1) : siteUrl;
    metaImage = `${baseUrl}/embed-mini.png`; // the branded link preview (tools/brand/previews.html)
  }

  const metaKeywords = config.keywords;

  const tags: (MetaTag | LinkTag)[] = [];

  if (fullTitle) {
    tags.push({ title: fullTitle });
  }

  if (siteDescription) {
    tags.push({ name: "description", content: siteDescription });
  }

  if (metaKeywords) {
    tags.push({ name: "keywords", content: metaKeywords });
  }

  if (config.themeColor) {
    tags.push({ name: "theme-color", content: config.themeColor });
  }

  if (siteUrl) {
    if (fullTitle) {
      tags.push({ property: "og:title", content: fullTitle });
    }

    if (siteName) {
      tags.push({ property: "og:site_name", content: siteName });
    }

    tags.push(
      { property: "og:type", content: "website" },
      { property: "og:url", content: fullUrl }
    );
    if (metaImage) {
      tags.push({ property: "og:image", content: metaImage });
    }

    if (siteDescription) {
      tags.push({ property: "og:description", content: siteDescription });
    }

    if (config.locale) {
      tags.push({ property: "og:locale", content: config.locale });
    }
  }

  if (config.twitterHandle || siteUrl) {
    tags.push({ name: "twitter:card", content: "summary_large_image" });

    if (fullTitle) {
      tags.push({ name: "twitter:title", content: fullTitle });
    }

    if (siteDescription) {
      tags.push({ name: "twitter:description", content: siteDescription });
    }

    if (config.twitterHandle) {
      tags.push({ name: "twitter:site", content: config.twitterHandle });
    }

    if (metaImage) {
      tags.push({ name: "twitter:image", content: metaImage });
    }
  }

  const hrefLangLinks = generateHrefLangLinks("");
  tags.push(...hrefLangLinks);
  return tags;
}
