import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const appRoot = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..");

const envSchema = z.object({
  PORT: z
    .string()
    .regex(/^\d+$/, "PORT must be an integer from 1 to 65535")
    .transform((value) => Number(value))
    .pipe(z.number().int().min(1).max(65535))
    .optional(),
  DATABASE_PATH: z.string().min(1, "DATABASE_PATH must not be empty").optional(),
  CORS_ORIGIN: z.url("CORS_ORIGIN must be a URL").optional(),
});

export type AppConfig = {
  port: number;
  databasePath: string;
  corsOrigin: string;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse({
    PORT: env.PORT,
    DATABASE_PATH: env.DATABASE_PATH,
    CORS_ORIGIN: env.CORS_ORIGIN,
  });
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "environment"}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid environment: ${details}`);
  }

  const databasePath = parsed.data.DATABASE_PATH ?? "./data/avatars.db";
  return {
    port: parsed.data.PORT ?? 3000,
    databasePath: path.isAbsolute(databasePath) ? databasePath : path.resolve(appRoot, databasePath),
    corsOrigin: parsed.data.CORS_ORIGIN ?? "http://localhost:5173",
  };
}
