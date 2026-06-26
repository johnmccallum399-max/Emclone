import cors from "cors";
import express, { type Express } from "express";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import { env } from "./config/env.js";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler.js";
import { apiRateLimiter } from "./middleware/rateLimit.js";
import { authRouter } from "./routes/auth.js";
import { chatRouter } from "./routes/chat.js";
import { memoryRouter } from "./routes/memory.js";
import { settingsRouter } from "./routes/settings.js";
import { voiceRouter } from "./routes/voice.js";
import { logger } from "./utils/logger.js";

export function createApp(): Express {
  const app = express();

  const allowedOrigins = env.CORS_ORIGIN.split(",").map((origin) => origin.trim());
  // A literal "*" entry in the cors `origin` array only matches a request
  // with an `Origin: *` header, which browsers never send — so it would
  // silently block every cross-origin request instead of allowing them.
  // Use `true` (reflect request origin) to make "*" behave as a real wildcard.
  const corsOrigin = allowedOrigins.includes("*") ? true : allowedOrigins;

  app.use(helmet());
  app.use(
    cors({
      origin: corsOrigin,
      credentials: true,
    })
  );
  app.use(express.json({ limit: "1mb" }));
  app.use(pinoHttp({ logger, autoLogging: env.NODE_ENV !== "test" }));
  app.use(apiRateLimiter);

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.use("/api/auth", authRouter);
  app.use("/api/chat", chatRouter);
  app.use("/api/memory", memoryRouter);
  app.use("/api/settings", settingsRouter);
  app.use("/api/voice", voiceRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
