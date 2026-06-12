import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env.js";

export interface AuthTokenPayload {
  sub: number; // user id
  username: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId?: number;
      username?: string;
    }
  }
}

export function signToken(payload: AuthTokenPayload): string {
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: env.JWT_EXPIRES_IN as any });
}

/**
 * Verifies the `Authorization: Bearer <token>` header and attaches the
 * authenticated user id to the request. Rejects with 401 if missing/invalid.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing or invalid Authorization header" });
    return;
  }

  const token = header.slice("Bearer ".length);
  try {
    const decoded = jwt.verify(token, env.JWT_SECRET) as unknown as AuthTokenPayload;
    req.userId = decoded.sub;
    req.username = decoded.username;
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}
