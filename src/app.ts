import express from "express";
import cors from "cors";
import { env } from "./config/env.js";
import { currentUser } from "./middleware/currentUser.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { gamesRouter } from "./routes/games.routes.js";
import { libraryRouter } from "./routes/library.routes.js";

export const app = express();

app.use(cors({ origin: env.CORS_ORIGIN }));
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, rawgConfigured: Boolean(env.RAWG_API_KEY) });
});

app.use("/api", currentUser);
app.use("/api/games", gamesRouter);
app.use("/api/library", libraryRouter);

app.use("/api", (_req, res) => {
  res.status(404).json({ error: "Ruta no encontrada" });
});

app.use(errorHandler);
