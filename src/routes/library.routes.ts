import { Router } from "express";
import {
  addEntrySchema,
  idParamSchema,
  listQuerySchema,
  updateEntrySchema,
} from "../schemas/library.schema.js";
import * as library from "../services/library.service.js";

export const libraryRouter = Router();

// GET /api/library?status=COMPLETED&sort=score&q=mario&favorite=true
libraryRouter.get("/", async (req, res) => {
  res.json(await library.listEntries(req.userId, listQuerySchema.parse(req.query)));
});

// GET /api/library/stats  (va antes de /:id)
libraryRouter.get("/stats", async (req, res) => {
  res.json(await library.getStats(req.userId));
});

libraryRouter.get("/:id", async (req, res) => {
  const { id } = idParamSchema.parse(req.params);
  res.json(await library.getEntry(req.userId, id));
});

// POST /api/library  { gameId, status?, score?, ... }
libraryRouter.post("/", async (req, res) => {
  const entry = await library.addEntry(req.userId, addEntrySchema.parse(req.body));
  res.status(201).json(entry);
});

// PATCH /api/library/:id  { status?, score?, hoursPlayed?, ... }
libraryRouter.patch("/:id", async (req, res) => {
  const { id } = idParamSchema.parse(req.params);
  res.json(await library.updateEntry(req.userId, id, updateEntrySchema.parse(req.body)));
});

libraryRouter.delete("/:id", async (req, res) => {
  const { id } = idParamSchema.parse(req.params);
  await library.deleteEntry(req.userId, id);
  res.status(204).end();
});
