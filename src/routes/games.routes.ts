import { Router } from "express";
import { z } from "zod";
import { getGame, searchGames } from "../lib/igdb.js";
import { entriesForGames } from "../services/library.service.js";

export const gamesRouter = Router();

const searchQuery = z.object({
  q: z.string().trim().min(1, "Escribe algo para buscar"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(40).default(20),
});

// GET /api/games/search?q=zelda&page=1
gamesRouter.get("/search", async (req, res) => {
  const { q, page, pageSize } = searchQuery.parse(req.query);
  const data = await searchGames(q, page, pageSize);
  const owned = await entriesForGames(req.userId, data.results.map((g) => g.id));
  res.json({
    ...data,
    results: data.results.map((g) => ({ ...g, libraryEntry: owned.get(g.id) ?? null })),
  });
});

// GET /api/games/:id  (id de IGDB)
gamesRouter.get("/:id", async (req, res) => {
  const { id } = z.object({ id: z.coerce.number().int().positive() }).parse(req.params);
  const [game, owned] = await Promise.all([getGame(id), entriesForGames(req.userId, [id])]);
  res.json({ ...game, libraryEntry: owned.get(id) ?? null });
});
