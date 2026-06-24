import type { NextFunction, Request, Response } from "express";
import { logger } from "../utils/logger.js";

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({ error: `Not found: ${req.method} ${req.path}` });
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  const isHttpError = err instanceof HttpError;
  const status = isHttpError ? err.status : 500;
  const message = err instanceof Error ? err.message : "Internal server error";

  if (status >= 500) {
    logger.error({ err, path: req.path }, "Unhandled error");
  } else {
    logger.warn({ err: message, path: req.path }, "Request error");
  }

  // HttpError messages are always deliberately thrown by our own code and
  // safe to expose; only mask messages from truly unexpected exceptions.
  res.status(status).json({ error: isHttpError ? message : status >= 500 ? "Internal server error" : message });
}
