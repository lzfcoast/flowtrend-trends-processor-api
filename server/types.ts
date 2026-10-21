export type UserRole = "user" | "admin";

export type User = {
  id: number;
  openId: string;
  name: string | null;
  email: string | null;
  loginMethod: string | null;
  role: UserRole;
  createdAt: Date;
  updatedAt: Date;
  lastSignedIn: Date;
};

export type InsertUser = Partial<Omit<User, "id" | "createdAt" | "updatedAt">> &
  Pick<User, "openId"> & {
    createdAt?: Date;
    updatedAt?: Date;
  };

export type Article = {
  id: number;
  term: string;
  title: string;
  content: string;
  summary: string | null;
  metaDescription?: string | null;
  category: string;
  trendStatus: string;
  relevanceScore: number;
  imageUrl: string | null;
  imageKey: string | null;
  searchVolume: string | null;
  googleSearchLink: string | null;
  sourceName: string | null;
  sourceUrl: string | null;
  notificationSent: number;
  createdAt: Date;
  updatedAt: Date;
};

export type InsertArticle = Omit<Article, "id" | "createdAt" | "updatedAt"> & {
  id?: number;
  createdAt?: Date;
  updatedAt?: Date;
};

export type TrendProcessed = {
  id: number;
  term: string;
  articleId: number | null;
  status: string;
  errorMessage: string | null;
  processedAt: Date;
  createdAt: Date;
};
