import { z } from "zod";

export const gameStatuses = ["PLAYING", "COMPLETED", "PLAN_TO_PLAY", "ON_HOLD", "DROPPED"] as const;

// Acepta "YYYY-MM-DD" o null
const dateField = z.iso.date().nullable().optional();

const entryFields = {
  status: z.enum(gameStatuses),
  score: z.number().int().min(1).max(10).nullable(),
  hoursPlayed: z.number().min(0).max(100_000).nullable(),
  platform: z.string().trim().max(100).nullable(),
  startedAt: dateField,
  finishedAt: dateField,
  notes: z.string().max(5000).nullable(),
  favorite: z.boolean(),
};

export const addEntrySchema = z
  .object({ gameId: z.number().int().positive() })
  .extend(z.object(entryFields).partial().shape);

export const updateEntrySchema = z.object(entryFields).partial();

export const listQuerySchema = z.object({
  status: z.enum(gameStatuses).optional(),
  favorite: z.stringbool().optional(),
  q: z.string().trim().optional(),
  sort: z.enum(["updated", "added", "name", "score", "hours", "released"]).default("updated"),
  order: z.enum(["asc", "desc"]).optional(),
});

export const idParamSchema = z.object({ id: z.coerce.number().int().positive() });

export type AddEntryInput = z.infer<typeof addEntrySchema>;
export type UpdateEntryInput = z.infer<typeof updateEntrySchema>;
export type ListQuery = z.infer<typeof listQuerySchema>;
