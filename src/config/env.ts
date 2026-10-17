import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  PORT: z.coerce.number().default(3000),
  CORS_ORIGIN: z.string().default("http://localhost:5173"),
  RAWG_API_KEY: z.string().default(""),
  DEFAULT_USER_EMAIL: z.string().min(1).default("me@local"),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error("Variables de entorno inválidas:", z.treeifyError(parsed.error));
  process.exit(1);
}

export const env = parsed.data;
