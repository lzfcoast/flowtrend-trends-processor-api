import { readFile } from "node:fs/promises";
import path from "node:path";

export type AdSlotConfig = {
  enabled?: boolean;
  type?: "adsense" | "banner" | "affiliate" | "html";
  client?: string;
  slot?: string;
  format?: string;
  link?: string;
  image?: string;
  html?: string;
  label?: string;
};

export type SiteConfig = {
  apiBaseUrl: string;
  siteUrl: string;
  links: Record<string, string>;
  ads: {
    enabled: boolean;
    slots: Record<string, AdSlotConfig>;
  };
};

const configPath = path.resolve(
  process.env.FLOWTREND_CONFIG_PATH ||
    path.join(process.cwd(), "server", "site-config.json")
);

const defaults: SiteConfig = {
  apiBaseUrl: "",
  siteUrl: "https://www.flowtrend.com.br",
  links: {
    home: "https://www.flowtrend.com.br/",
    explore: "#pautas",
    github: "https://github.com/",
    linkedin: "https://www.linkedin.com/",
    youtube: "https://www.youtube.com/",
    instagram: "https://www.instagram.com/",
    facebook: "https://www.facebook.com/",
  },
  ads: { enabled: false, slots: {} },
};

function publicUrl(value: unknown, fallback: string): string {
  if (typeof value !== "string" || !value.trim()) return fallback;
  const candidate = value.trim();
  if (candidate.startsWith("#") || candidate.startsWith("/")) return candidate;
  try {
    const url = new URL(candidate);
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.href
      : fallback;
  } catch {
    return fallback;
  }
}

function cleanConfig(raw: Partial<SiteConfig>): SiteConfig {
  const links = { ...defaults.links };
  for (const [key, value] of Object.entries(raw.links || {})) {
    links[key] = publicUrl(value, links[key] || "#");
  }
  const slots: Record<string, AdSlotConfig> = {};
  for (const [key, value] of Object.entries(raw.ads?.slots || {})) {
    if (!value || typeof value !== "object") continue;
    slots[key] = {
      enabled: Boolean(value.enabled),
      type:
        value.type === "banner" ||
        value.type === "affiliate" ||
        value.type === "html"
          ? value.type
          : "adsense",
      client: typeof value.client === "string" ? value.client.trim() : "",
      slot: typeof value.slot === "string" ? value.slot.trim() : "",
      format: typeof value.format === "string" ? value.format.trim() : "auto",
      link: publicUrl(value.link, ""),
      image: publicUrl(value.image, ""),
      html: typeof value.html === "string" ? value.html.slice(0, 20000) : "",
      label:
        typeof value.label === "string" && value.label.trim()
          ? value.label.trim().slice(0, 80)
          : "Publicidade",
    };
  }
  return {
    apiBaseUrl: publicUrl(
      process.env.FLOWTREND_API_BASE_URL || raw.apiBaseUrl,
      ""
    ),
    siteUrl: publicUrl(
      process.env.FLOWTREND_SITE_URL || raw.siteUrl,
      defaults.siteUrl
    ),
    links,
    ads: { enabled: Boolean(raw.ads?.enabled), slots },
  };
}

export async function getSiteConfig(): Promise<SiteConfig> {
  let raw: Partial<SiteConfig> = {};
  try {
    raw = JSON.parse(await readFile(configPath, "utf8")) as Partial<SiteConfig>;
  } catch (error) {
    console.warn(
      `[SiteConfig] Could not read ${configPath}; using defaults`,
      error
    );
  }
  return cleanConfig(raw);
}
