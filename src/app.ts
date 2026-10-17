import express from "express";
import cors from "cors";
import { env } from "./config/env.js";
import { requireUser } from "./middleware/currentUser.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { authRouter } from "./routes/auth.routes.js";
import { gamesRouter } from "./routes/games.routes.js";
import { libraryRouter } from "./routes/library.routes.js";
import { steamRouter } from "./routes/steam.routes.js";

export const app = express();

app.use(cors({ origin: env.CORS_ORIGIN, credentials: true }));
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, igdbConfigured: Boolean(env.IGDB_CLIENT_ID && env.IGDB_CLIENT_SECRET), steamConfigured: Boolean(env.STEAM_API_KEY) });
});

app.use("/api/auth", authRouter);
app.use("/api/games", requireUser, gamesRouter);
app.use("/api/library", requireUser, libraryRouter);
app.use("/api/steam", steamRouter);

app.use("/api", (_req, res) => {
  res.status(404).json({ error: "Ruta no encontrada" });
});

app.use(errorHandler);
