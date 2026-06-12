import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  CORS_ORIGIN: z.string().default("http://localhost:5173"),

  JWT_SECRET: z.string().min(16, "JWT_SECRET must be at least 16 characters"),
  JWT_EXPIRES_IN: z.string().default("12h"),
  APP_USERNAME: z.string().default("admin"),
  APP_PASSWORD: z.string().default(""),

  OPENAI_API_KEY: z.string().min(1, "OPENAI_API_KEY is required"),
  OPENAI_MODEL: z.string().default("gpt-4o-mini"),
  OPENAI_TTS_MODEL: z.string().default("tts-1"),
  OPENAI_TTS_VOICE: z.string().default("alloy"),
  OPENAI_STT_MODEL: z.string().default("whisper-1"),
  OPENAI_REALTIME_MODEL: z.string().default("gpt-4o-mini-realtime-preview"),

  DATABASE_URL: z.string().optional(),
  SQLITE_PATH: z.string().default("./data/app.db"),

  TAVILY_API_KEY: z.string().optional(),
  PLACEHOLDER_API_URL: z.string().optional(),

  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(60),

  LOG_LEVEL: z.string().default("info"),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}

export const env = loadEnv();

export const isProduction = env.NODE_ENV === "production";
export const isTest = env.NODE_ENV === "test";
