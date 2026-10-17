import { Router } from "express";
import { getStats } from "../services/stats.service.js";

export const statsRouter = Router();

// GET /api/stats  → todo lo de la página de estadísticas
statsRouter.get("/", async (req, res) => {
  res.json(await getStats(req.userId));
});
