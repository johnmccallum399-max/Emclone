import type { IncomingMessage, ServerResponse } from "node:http";
import { createApp } from "../src/app.js";
import { getDb } from "../src/db/index.js";
import { ensureSeedUser } from "../src/services/bootstrap.js";
import { logger } from "../src/utils/logger.js";

/**
 * Vercel serverless entrypoint for the Express backend.
 *
 * Unlike `src/index.ts` (used for traditional Node hosts such as Render),
 * this never calls `app.listen()` - Vercel's Node.js runtime invokes the
 * exported handler directly per request. Vercel reuses warm instances
 * across invocations, so DB initialization and user-seeding happen once per
 * instance via a cached promise, not on every request.
 */
const app = createApp();

let readyPromise: Promise<void> | null = null;
function ensureReady(): Promise<void> {
  if (!readyPromise) {
    readyPromise = (async () => {
      await getDb().init();
      await ensureSeedUser();
    })().catch((err) => {
      // Let the next invocation retry instead of permanently wedging this
      // warm instance on a transient failure (e.g. DB briefly unreachable).
      readyPromise = null;
      throw err;
    });
  }
  return readyPromise;
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    await ensureReady();
  } catch (err) {
    logger.error(err, "Fatal error during startup");
    res.statusCode = 503;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Service temporarily unavailable" }));
    return;
  }
  app(req, res);
}
