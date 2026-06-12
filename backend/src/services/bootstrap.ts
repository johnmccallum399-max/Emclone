import bcrypt from "bcryptjs";
import { env } from "../config/env.js";
import { getDb } from "../db/index.js";
import { logger } from "../utils/logger.js";

/**
 * Seeds the first user from APP_USERNAME / APP_PASSWORD if the users table
 * is empty. This makes the app usable immediately on first boot without a
 * separate signup flow, while still storing only a bcrypt hash.
 */
export async function ensureSeedUser(): Promise<void> {
  const db = getDb();
  const userCount = await db.countUsers();
  if (userCount > 0) return;

  if (!env.APP_PASSWORD) {
    logger.warn(
      "No users exist and APP_PASSWORD is not set. Set APP_USERNAME/APP_PASSWORD in .env " +
        "and restart, or create a user manually, before logging in."
    );
    return;
  }

  const passwordHash = await bcrypt.hash(env.APP_PASSWORD, 10);
  await db.createUser(env.APP_USERNAME, passwordHash);
  logger.info(`Seeded initial user '${env.APP_USERNAME}'. You can change the password after logging in.`);
}
