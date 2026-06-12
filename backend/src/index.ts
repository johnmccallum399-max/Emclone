import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { getDb } from "./db/index.js";
import { ensureSeedUser } from "./services/bootstrap.js";
import { logger } from "./utils/logger.js";

async function main(): Promise<void> {
  await getDb().init();
  await ensureSeedUser();

  const app = createApp();
  app.listen(env.PORT, () => {
    logger.info(`Personal AI Assistant backend listening on port ${env.PORT} (${env.NODE_ENV})`);
  });
}

main().catch((err) => {
  logger.error(err, "Fatal error during startup");
  process.exit(1);
});
