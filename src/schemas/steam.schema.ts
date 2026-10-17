import { z } from "zod";
import { gameStatuses } from "./library.schema.js";

export const importSchema = z.object({
  items: z
    .array(z.object({ appId: z.number().int().positive(), status: z.enum(gameStatuses) }))
    .min(1, "Elige al menos un juego")
    .max(500),
});

export const igdbIdParam = z.object({ igdbId: z.coerce.number().int().positive() });

export type ImportInput = z.infer<typeof importSchema>;
