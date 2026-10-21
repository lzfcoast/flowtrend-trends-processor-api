import type { Express, Request } from "express";
import {
  getArticleById,
  getArticleCategories,
  getArticles,
  getArticlesCount,
  type ArticleFilters,
} from "./db";
import { getSiteConfig } from "./siteConfig";
import {
  automationTokenIsValid,
  readEditorialExport,
  requestPayload,
  runEditorialProcessor,
  saveEditorialExport,
} from "./editorialProcessor";

const MAX_LIMIT = 100;

function numberQuery(
  value: unknown,
  fallback: number,
  min: number,
  max: number
) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

function textQuery(value: unknown, maxLength: number) {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  return text ? text.slice(0, maxLength) : undefined;
}

function automationRequestAuthorized(req: Request) {
  const authorization = req.header("authorization") || "";
  const bearer = authorization.toLowerCase().startsWith("bearer ")
    ? authorization.slice(7).trim()
    : "";
  return automationTokenIsValid(req.header("x-flowtrend-token") || bearer);
}

function buildFilters(req: Request): ArticleFilters {
  const period = textQuery(req.query.period, 8);
  const status = textQuery(req.query.status, 20);
  const sort = textQuery(req.query.sort, 20);

  return {
    query: textQuery(req.query.query ?? req.query.q, 120),
    category: textQuery(req.query.category, 100),
    period:
      period === "24h" || period === "7d" || period === "30d"
        ? period
        : undefined,
    status: status === "em-alta" || status === "estavel" ? status : undefined,
    sort: sort === "relevantes" ? "relevantes" : "recentes",
  };
}

export function registerRestApi(app: Express) {
  app.get("/api/health", async (_req, res, next) => {
    try {
      const total = await getArticlesCount();
      res.json({
        status: "ok",
        service: "flowtrend-headless-api",
        totalArticles: total,
        now: new Date().toISOString(),
      });
    } catch (error) {
      next(error);
    }
  });

  const listTrends = async (req: Request, res: any, next: any) => {
    try {
      const limit = numberQuery(req.query.limit, 20, 1, MAX_LIMIT);
      const offset = numberQuery(
        req.query.offset,
        0,
        0,
        Number.MAX_SAFE_INTEGER
      );
      const filters = buildFilters(req);
      const [items, total] = await Promise.all([
        getArticles(limit, offset, filters),
        getArticlesCount(filters),
      ]);

      res.json({
        items,
        total,
        limit,
        offset,
        hasMore: offset + items.length < total,
        filters,
      });
    } catch (error) {
      next(error);
    }
  };

  app.get("/api/trends", listTrends);
  app.get("/api/rest/trends", listTrends);

  app.get("/api/trends/:id", async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        res.status(400).json({ error: "id must be a positive integer" });
        return;
      }

      const article = await getArticleById(id);
      if (!article) {
        res.status(404).json({ error: "Trend not found" });
        return;
      }
      res.json(article);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/categories", async (_req, res, next) => {
    try {
      res.json({ items: await getArticleCategories() });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/site-config", async (_req, res, next) => {
    try {
      res.setHeader("Cache-Control", "no-store");
      res.json(await getSiteConfig());
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/editorial/process", async (req, res, next) => {
    try {
      if (!automationRequestAuthorized(req)) {
        res.status(401).json({ error: "Invalid automation token" });
        return;
      }
      const payload = requestPayload(req.body);
      if (!payload.trim()) {
        res.status(400).json({ error: "Request body is empty" });
        return;
      }
      const processed = await runEditorialProcessor(payload, "json");
      const xml = await runEditorialProcessor(payload, "xml");
      await saveEditorialExport(xml);
      res.json(JSON.parse(processed));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/editorial/export.xml", async (req, res, next) => {
    try {
      if (!automationRequestAuthorized(req)) {
        res.status(401).type("text").send("Invalid automation token");
        return;
      }
      const payload = requestPayload(req.body);
      if (!payload.trim()) {
        res.status(400).type("text").send("Request body is empty");
        return;
      }
      const xml = await runEditorialProcessor(payload, "xml");
      await saveEditorialExport(xml);
      res
        .type("application/xml")
        .setHeader(
          "Content-Disposition",
          "attachment; filename=flowtrend-blogger-export.xml"
        )
        .send(xml);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/editorial/export.xml", async (_req, res, next) => {
    try {
      const xml = await readEditorialExport();
      res
        .type("application/xml")
        .setHeader(
          "Content-Disposition",
          "attachment; filename=flowtrend-blogger-export.xml"
        )
        .send(xml);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        res
          .status(404)
          .type("text")
          .send("No editorial export has been generated yet");
        return;
      }
      next(error);
    }
  });

  app.use(
    (
      error: unknown,
      _req: Request,
      res: {
        headersSent: boolean;
        status: (code: number) => typeof res;
        json: (body: unknown) => void;
      },
      next: () => void
    ) => {
      if (res.headersSent) {
        next();
        return;
      }
      console.error("[REST] Request failed:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  );
}
