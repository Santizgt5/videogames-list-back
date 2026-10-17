import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  PORT: z.coerce.number().default(3000),
  CORS_ORIGIN: z.string().default("http://localhost:5173"),
  IGDB_CLIENT_ID: z.string().default(""),
  IGDB_CLIENT_SECRET: z.string().default(""),
  STEAM_API_KEY: z.string().default(""),
  /** URL desde la que el navegador abre la app (Steam vuelve aquí tras iniciar sesión) */
  APP_URL: z.string().default("http://localhost:5173"),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error("Variables de entorno inválidas:", z.treeifyError(parsed.error));
  process.exit(1);
}

export const env = parsed.data;
