import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { ENV } from "./_core/env";
import { inferArticleCategory } from "./category";
import type {
  Article,
  InsertArticle,
  InsertUser,
  TrendProcessed,
  User,
} from "./types";

export type ArticleFilters = {
  query?: string;
  category?: string;
  period?: "24h" | "7d" | "30d";
  status?: "em-alta" | "estavel";
  sort?: "recentes" | "relevantes";
};

type DatabaseState = {
  users: User[];
  articles: Article[];
  trendsProcessed: TrendProcessed[];
  counters: {
    users: number;
    articles: number;
    trendsProcessed: number;
  };
};

const databasePath = path.resolve(
  process.env.LOCAL_DATABASE_PATH ||
    path.join(process.cwd(), "server", "database.json")
);
let writeQueue: Promise<unknown> = Promise.resolve();
let databaseReady: Promise<void> | null = null;

const DEFAULT_ARTICLE_RETENTION_DAYS = 45;
const DEFAULT_ARTICLE_RETENTION_MAX = 300;

const emptyDatabase = (): DatabaseState => ({
  users: [],
  articles: [],
  trendsProcessed: [],
  counters: { users: 1, articles: 1, trendsProcessed: 1 },
});

function toDate(value: Date | string | undefined, fallback = new Date()): Date {
  const date =
    value instanceof Date ? value : value ? new Date(value) : fallback;
  return Number.isNaN(date.getTime()) ? fallback : date;
}

function normalizeDatabase(raw: Partial<DatabaseState>): DatabaseState {
  const database = emptyDatabase();
  database.users = (raw.users || []).map(user => ({
    ...user,
    name: user.name ?? null,
    email: user.email ?? null,
    loginMethod: user.loginMethod ?? null,
    role: user.role || "user",
    createdAt: toDate(user.createdAt),
    updatedAt: toDate(user.updatedAt),
    lastSignedIn: toDate(user.lastSignedIn),
  }));
  database.articles = (raw.articles || []).map(article => ({
    ...article,
    category: inferArticleCategory(
      article.category,
      article.term,
      article.title,
      article.summary,
      article.content
    ),
    summary: article.summary ?? null,
    metaDescription: article.metaDescription ?? article.summary ?? null,
    imageUrl: article.imageUrl ?? null,
    imageKey: article.imageKey ?? null,
    searchVolume: article.searchVolume ?? null,
    googleSearchLink: article.googleSearchLink ?? null,
    sourceName: article.sourceName ?? null,
    sourceUrl: article.sourceUrl ?? null,
    notificationSent: article.notificationSent ?? 0,
    createdAt: toDate(article.createdAt),
    updatedAt: toDate(article.updatedAt),
  }));
  database.trendsProcessed = (raw.trendsProcessed || []).map(trend => ({
    ...trend,
    articleId: trend.articleId ?? null,
    errorMessage: trend.errorMessage ?? null,
    processedAt: toDate(trend.processedAt),
    createdAt: toDate(trend.createdAt),
  }));

  database.counters = {
    users: Math.max(
      raw.counters?.users || 1,
      ...database.users.map(item => item.id + 1)
    ),
    articles: Math.max(
      raw.counters?.articles || 1,
      ...database.articles.map(item => item.id + 1)
    ),
    trendsProcessed: Math.max(
      raw.counters?.trendsProcessed || 1,
      ...database.trendsProcessed.map(item => item.id + 1)
    ),
  };
  return database;
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function getArticleRetentionConfig(
  env: NodeJS.ProcessEnv = process.env
) {
  return {
    days: positiveInteger(
      env.ARTICLE_RETENTION_DAYS,
      DEFAULT_ARTICLE_RETENTION_DAYS
    ),
    maxArticles: positiveInteger(
      env.ARTICLE_RETENTION_MAX,
      DEFAULT_ARTICLE_RETENTION_MAX
    ),
  };
}

async function ensureParentDirectory() {
  await mkdir(path.dirname(databasePath), { recursive: true });
}

async function ensureDatabaseFile(): Promise<void> {
  if (!databaseReady) {
    databaseReady = (async () => {
      await ensureParentDirectory();
      try {
        await readFile(databasePath, "utf8");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        await writeFile(
          databasePath,
          JSON.stringify(emptyDatabase(), null, 2) + "\n",
          "utf8"
        );
      }
    })().catch(error => {
      databaseReady = null;
      throw error;
    });
  }
  await databaseReady;
}

async function readDatabase(): Promise<DatabaseState> {
  await ensureDatabaseFile();
  const content = await readFile(databasePath, "utf8");
  try {
    return normalizeDatabase(JSON.parse(content) as Partial<DatabaseState>);
  } catch (error) {
    throw new Error(
      `Arquivo de banco JSON inválido em ${databasePath}: ${String(error)}`
    );
  }
}

async function writeDatabase(database: DatabaseState): Promise<void> {
  await ensureParentDirectory();
  const temporaryPath = `${databasePath}.${process.pid}.tmp`;
  await writeFile(
    temporaryPath,
    JSON.stringify(database, null, 2) + "\n",
    "utf8"
  );
  await rename(temporaryPath, databasePath);
}

function withWriteLock<T>(
  operation: (database: DatabaseState) => Promise<T> | T
): Promise<T> {
  const result = writeQueue.then(async () => {
    const database = await readDatabase();
    const value = await operation(database);
    await writeDatabase(database);
    return value;
  });
  writeQueue = result.then(
    () => undefined,
    () => undefined
  );
  return result;
}

/** Remove artigos antigos/excedentes e seus registros de processamento. */
export async function pruneOldArticles(): Promise<number> {
  const { days, maxArticles } = getArticleRetentionConfig();
  const cutoff = Date.now() - days * 86_400_000;

  return withWriteLock(database => {
    const recentArticles = [...database.articles]
      .filter(article => article.createdAt.getTime() >= cutoff)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const retainedArticles = recentArticles.slice(0, maxArticles);
    const retainedIds = new Set(retainedArticles.map(article => article.id));
    const removedCount = database.articles.length - retainedArticles.length;

    database.articles = retainedArticles;
    database.trendsProcessed = database.trendsProcessed.filter(trend => {
      const isRecent = trend.processedAt.getTime() >= cutoff;
      return isRecent && (!trend.articleId || retainedIds.has(trend.articleId));
    });

    return removedCount;
  });
}

/** Creates server/database.json before the HTTP server starts. */
export async function initializeDatabase(): Promise<string> {
  await readDatabase();
  const removedCount = await pruneOldArticles();
  if (removedCount > 0) {
    console.log(`[Database] Retention removed ${removedCount} old article(s)`);
  }
  console.log(`[Database] Local JSON database ready: ${databasePath}`);
  return databasePath;
}

/** Kept as a compatibility boundary for code that previously asked for a DB connection. */
export async function getDb(): Promise<{ kind: "json"; path: string }> {
  await initializeDatabase();
  return { kind: "json", path: databasePath };
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");

  await withWriteLock(database => {
    const now = new Date();
    const existing = database.users.find(item => item.openId === user.openId);
    const values = {
      name: user.name ?? existing?.name ?? null,
      email: user.email ?? existing?.email ?? null,
      loginMethod: user.loginMethod ?? existing?.loginMethod ?? null,
      role:
        user.role ||
        existing?.role ||
        (user.openId === ENV.ownerOpenId ? "admin" : "user"),
      lastSignedIn: toDate(user.lastSignedIn, now),
    } as const;

    if (existing) {
      Object.assign(existing, values, { updatedAt: now });
      return;
    }

    database.users.push({
      id: database.counters.users++,
      openId: user.openId,
      ...values,
      createdAt: toDate(user.createdAt, now),
      updatedAt: now,
    });
  });
}

export async function getUserByOpenId(
  openId: string
): Promise<User | undefined> {
  const database = await readDatabase();
  return database.users.find(user => user.openId === openId);
}

function matchesArticle(article: Article, filters: ArticleFilters): boolean {
  const query = filters.query?.trim().toLocaleLowerCase("pt-BR");
  if (query) {
    const haystack = [
      article.title,
      article.summary,
      article.term,
      article.content,
    ]
      .filter(Boolean)
      .join(" ")
      .toLocaleLowerCase("pt-BR");
    if (!haystack.includes(query)) return false;
  }
  if (
    filters.category &&
    filters.category !== "Todas" &&
    article.category !== filters.category
  ) {
    return false;
  }
  if (filters.status && article.trendStatus !== filters.status) return false;
  if (filters.period) {
    const days =
      filters.period === "24h" ? 1 : filters.period === "7d" ? 7 : 30;
    if (article.createdAt.getTime() < Date.now() - days * 86400000)
      return false;
  }
  return true;
}

export async function getArticles(
  limit = 20,
  offset = 0,
  filters: ArticleFilters = {}
): Promise<Article[]> {
  const database = await readDatabase();
  const articles = database.articles.filter(article =>
    matchesArticle(article, filters)
  );
  articles.sort((a, b) => {
    if (
      filters.sort === "relevantes" &&
      b.relevanceScore !== a.relevanceScore
    ) {
      return b.relevanceScore - a.relevanceScore;
    }
    return b.createdAt.getTime() - a.createdAt.getTime();
  });
  return articles.slice(
    Math.max(0, offset),
    Math.max(0, offset) + Math.min(Math.max(0, limit), 100)
  );
}

export async function getArticleById(id: number): Promise<Article | undefined> {
  const database = await readDatabase();
  return database.articles.find(article => article.id === id);
}

export async function getArticlesCount(
  filters: ArticleFilters = {}
): Promise<number> {
  const database = await readDatabase();
  return database.articles.filter(article => matchesArticle(article, filters))
    .length;
}

export async function getArticleCategories(): Promise<string[]> {
  const database = await readDatabase();
  return [...new Set(database.articles.map(article => article.category))].sort(
    (a, b) => a.localeCompare(b, "pt-BR")
  );
}

export async function insertArticle(
  article: InsertArticle
): Promise<Array<{ insertId: number; skipped?: boolean }>> {
  return withWriteLock(database => {
    if (!article.imageUrl) {
      throw new Error("Cannot persist an article without imageUrl");
    }
    try {
      const imageUrl = new URL(article.imageUrl);
      if (imageUrl.protocol !== "https:") {
        throw new Error("Article imageUrl must use HTTPS");
      }
    } catch (error) {
      throw new Error(`Invalid article imageUrl: ${String(error)}`);
    }

    const duplicate = database.articles.find(
      existing =>
        existing.term === article.term ||
        existing.title === article.title ||
        (article.sourceUrl && existing.sourceUrl === article.sourceUrl)
    );
    if (duplicate) {
      return [{ insertId: duplicate.id, skipped: true }];
    }

    const now = new Date();
    const id = article.id ?? database.counters.articles++;
    if (id >= database.counters.articles) database.counters.articles = id + 1;
    database.articles.push({
      ...article,
      id,
      summary: article.summary ?? null,
      imageUrl: article.imageUrl ?? null,
      imageKey: article.imageKey ?? null,
      searchVolume: article.searchVolume ?? null,
      googleSearchLink: article.googleSearchLink ?? null,
      sourceName: article.sourceName ?? null,
      sourceUrl: article.sourceUrl ?? null,
      notificationSent: article.notificationSent ?? 0,
      createdAt: toDate(article.createdAt, now),
      updatedAt: toDate(article.updatedAt, now),
    });
    return [{ insertId: id }];
  });
}

export async function findExistingArticle(identity: {
  term?: string;
  title?: string;
  sourceUrl?: string;
}): Promise<Pick<Article, "id" | "term" | "title" | "sourceUrl"> | undefined> {
  const database = await readDatabase();
  const result = database.articles.find(article =>
    [
      identity.term && article.term === identity.term.trim(),
      identity.title && article.title === identity.title.trim(),
      identity.sourceUrl && article.sourceUrl === identity.sourceUrl.trim(),
    ].some(Boolean)
  );
  return result
    ? {
        id: result.id,
        term: result.term,
        title: result.title,
        sourceUrl: result.sourceUrl,
      }
    : undefined;
}

export async function isTrendProcessed(term: string): Promise<boolean> {
  const database = await readDatabase();
  return database.trendsProcessed.some(item => item.term === term);
}

export async function recordProcessedTrend(
  term: string,
  articleId?: number,
  status = "success",
  errorMessage?: string
): Promise<void> {
  await withWriteLock(database => {
    const now = new Date();
    const existing = database.trendsProcessed.find(item => item.term === term);
    if (existing) {
      Object.assign(existing, {
        articleId: articleId ?? existing.articleId,
        status,
        errorMessage: errorMessage ?? null,
        processedAt: now,
      });
      return;
    }
    database.trendsProcessed.push({
      id: database.counters.trendsProcessed++,
      term,
      articleId: articleId ?? null,
      status,
      errorMessage: errorMessage ?? null,
      processedAt: now,
      createdAt: now,
    });
  });
}
