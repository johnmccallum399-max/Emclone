import bcrypt from "bcryptjs";
import { Router } from "express";
import { z } from "zod";
import { getDb } from "../db/index.js";
import { requireAuth, signToken } from "../middleware/auth.js";
import { authRateLimiter } from "../middleware/rateLimit.js";
import { asyncHandler } from "../utils/asyncHandler.js";

export const authRouter = Router();

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

authRouter.post(
  "/login",
  authRateLimiter,
  asyncHandler(async (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "username and password are required" });
      return;
    }

    const { username, password } = parsed.data;
    const db = getDb();
    const user = await db.getUserByUsername(username);
    if (!user) {
      res.status(401).json({ error: "Invalid username or password" });
      return;
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      res.status(401).json({ error: "Invalid username or password" });
      return;
    }

    const token = signToken({ sub: user.id, username: user.username });
    res.json({ token, user: { id: user.id, username: user.username } });
  })
);

authRouter.get(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    const db = getDb();
    const user = await db.getUserById(req.userId!);
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    res.json({ user: { id: user.id, username: user.username } });
  })
);
