import "dotenv/config";
import cors from "cors";
import express from "express";
import { createServer } from "http";
import { initializeDatabase } from "../db";
import { registerRestApi } from "../rest";
import { startTrendsScheduler } from "../trends";
import {
  editorialExportDirectory,
  ensureEditorialExportStorage,
} from "../editorialProcessor";

async function startServer() {
  await initializeDatabase();
  await ensureEditorialExportStorage();

  const app = express();
  const server = createServer(app);

  app.disable("x-powered-by");
  app.use(cors({ origin: "*" }));
  app.use(express.json({ limit: "1mb" }));
  app.use(
    express.text({
      type: [
        "application/xml",
        "text/xml",
        "application/rss+xml",
        "text/plain",
      ],
      limit: "2mb",
    })
  );
  app.use(
    "/exports",
    express.static(editorialExportDirectory, {
      index: false,
      fallthrough: true,
      setHeaders: response => {
        response.setHeader("Cache-Control", "no-cache");
        response.setHeader(
          "Content-Disposition",
          "attachment; filename=flowtrend-blogger-export.xml"
        );
      },
    })
  );
  registerRestApi(app);

  const port = Number(process.env.PORT || "3000");
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("Invalid PORT");
  }

  server.on("error", error => {
    console.error("Server failed:", error.message);
    process.exit(1);
  });

  server.listen(port, "0.0.0.0", () => {
    console.log(`[Headless API] Listening on port ${port}`);
    const stopTrendsScheduler = startTrendsScheduler();
    const shutdown = () => {
      stopTrendsScheduler();
      server.close(() => process.exit(0));
    };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  });
}

startServer().catch(error => {
  console.error("[Headless API] Startup failed:", error);
  process.exit(1);
});
