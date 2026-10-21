export type ImageResolution = {
  url: string;
  key: string | null;
  provider: "google-trends" | "wikimedia" | "ai";
};

type WikimediaImagePage = {
  title?: string;
  imageinfo?: Array<{
    url?: string;
    thumburl?: string;
    mime?: string;
    width?: number;
    height?: number;
  }>;
};

export function isSafeImageUrl(value?: string): value is string {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && Boolean(url.hostname);
  } catch {
    return false;
  }
}

function normalizeSearchTokens(value: string): string[] {
  return value
    .toLocaleLowerCase("pt-BR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(/[^\p{L}\p{N}]+/u)
    .filter(token => token.length > 2);
}

function contextualQueries(
  term: string,
  title: string,
  category?: string
): string[] {
  const normalized = normalizeSearchTokens(`${term} ${title}`);
  const categoryHint = category && category !== "Tendências" ? category : "";
  const queries = [`${title} ${term} ${categoryHint}`.trim()];
  const contexts: Array<{ words: string[]; hint: string }> = [
    {
      words: [
        "futebol",
        "fifa",
        "vasco",
        "corinthians",
        "flamengo",
        "rayo",
        "atletico",
        "cruzeiro",
        "jogo",
        "gol",
      ],
      hint: "futebol estádio partida",
    },
    {
      words: [
        "politica",
        "governo",
        "presidente",
        "senado",
        "camara",
        "eleicao",
        "ministro",
        "stf",
      ],
      hint: "política governo Brasil",
    },
    {
      words: [
        "economia",
        "fmi",
        "inflacao",
        "pib",
        "dolar",
        "investidor",
        "mercado",
        "juros",
      ],
      hint: "economia mercado Brasil",
    },
    {
      words: [
        "pm",
        "policia",
        "crime",
        "seguranca",
        "prisao",
        "delegacia",
        "morte",
        "assalto",
      ],
      hint: "segurança pública polícia",
    },
    {
      words: [
        "filme",
        "ator",
        "atriz",
        "novela",
        "musica",
        "cantor",
        "show",
        "celebridade",
      ],
      hint: "entretenimento cultura",
    },
  ];

  const context = contexts.find(({ words }) =>
    words.some(word => normalized.includes(word))
  );
  if (context) queries.push(`${term} ${context.hint}`);
  else if (categoryHint) queries.push(`${term} ${categoryHint} notícia Brasil`);
  else queries.push(`${term} notícia Brasil`);
  return [...new Set(queries.filter(Boolean))];
}

async function searchWikimedia(query: string): Promise<string | null> {
  const url = new URL("https://commons.wikimedia.org/w/api.php");
  url.search = new URLSearchParams({
    action: "query",
    format: "json",
    origin: "*",
    generator: "search",
    gsrnamespace: "6",
    gsrsearch: query,
    gsrlimit: "10",
    prop: "imageinfo",
    iiprop: "url|mime|size",
    iiurlwidth: "1200",
  }).toString();

  const response = await fetch(url, {
    headers: {
      "User-Agent": "TendenciasBrasil/1.0 (editorial image resolver)",
    },
  });
  if (!response.ok)
    throw new Error(`Wikimedia search failed: ${response.status}`);

  const payload = (await response.json()) as {
    query?: { pages?: Record<string, WikimediaImagePage> };
  };
  const pages = Object.values(payload.query?.pages || {});
  const queryTokens = new Set(normalizeSearchTokens(query));
  const candidates = pages
    .map(page => {
      const info = page.imageinfo?.[0];
      const imageUrl = info?.thumburl || info?.url;
      if (
        !imageUrl ||
        !info?.mime?.startsWith("image/") ||
        info.mime === "image/svg+xml"
      ) {
        return null;
      }

      const pageTokens = normalizeSearchTokens(page.title || "");
      const overlap = pageTokens.filter(token => queryTokens.has(token)).length;
      const area = (info.width || 0) * (info.height || 0);
      return {
        imageUrl,
        score: overlap * 100 + Math.min(area / 1_000_000, 20),
      };
    })
    .filter((candidate): candidate is { imageUrl: string; score: number } =>
      Boolean(candidate)
    )
    .sort((a, b) => b.score - a.score);

  return candidates[0]?.imageUrl || null;
}

/** Search Commons by subject and then by a topic-specific context. */
export async function findWikimediaImage(
  term: string,
  title: string,
  category?: string
): Promise<string | null> {
  for (const query of contextualQueries(term, title, category)) {
    try {
      const image = await searchWikimedia(query);
      if (image) return image;
    } catch (error) {
      console.warn(
        `[Trends] Wikimedia image lookup failed for "${query}":`,
        error
      );
    }
  }
  return null;
}

export async function resolveArticleImage(
  term: string,
  title: string,
  officialImageUrl: string | undefined,
  generateAiImage: () => Promise<{ url: string; key: string } | null>,
  category?: string
): Promise<ImageResolution | null> {
  if (isSafeImageUrl(officialImageUrl)) {
    return { url: officialImageUrl, key: null, provider: "google-trends" };
  }

  const wikimediaUrl = await findWikimediaImage(term, title, category);
  if (wikimediaUrl) {
    return { url: wikimediaUrl, key: null, provider: "wikimedia" };
  }

  const generated = await generateAiImage();
  if (generated?.url) {
    return { url: generated.url, key: generated.key, provider: "ai" };
  }

  return null;
}
