import { Router } from "express";
import { z } from "zod";
import { getDb } from "../db/index.js";
import { requireAuth } from "../middleware/auth.js";
import { HttpError } from "../middleware/errorHandler.js";
import { asyncHandler } from "../utils/asyncHandler.js";

export const memoryRouter = Router();

memoryRouter.use(requireAuth);

memoryRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const entries = await getDb().listMemory(req.userId!);
    res.json({ entries });
  })
);

const setMemorySchema = z.object({
  key: z.string().min(1).max(100),
  value: z.string().min(1).max(2000),
});

memoryRouter.put(
  "/",
  asyncHandler(async (req, res) => {
    const parsed = setMemorySchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, "'key' and 'value' are required");
    await getDb().setMemory(req.userId!, parsed.data.key, parsed.data.value);
    res.status(204).send();
  })
);

memoryRouter.delete(
  "/:key",
  asyncHandler(async (req, res) => {
    await getDb().deleteMemory(req.userId!, req.params.key);
    res.status(204).send();
  })
);
