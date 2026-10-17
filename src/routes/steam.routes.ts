import { randomBytes } from "node:crypto";
import { Router, type Request } from "express";
import { env } from "../config/env.js";
import { HttpError } from "../lib/httpError.js";
import { steamConfigured, steamLoginUrl, verifySteamLogin } from "../lib/steam.js";
import { requireUser } from "../middleware/currentUser.js";
import { igdbIdParam, importSchema } from "../schemas/steam.schema.js";
import * as steam from "../services/steam.service.js";

export const steamRouter = Router();
steamRouter.use(requireUser);

const STATE_COOKIE = "steam_state";

function readCookie(req: Request, name: string) {
  for (const part of req.headers.cookie?.split(";") ?? []) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

// GET /api/steam  → estado de la conexión
steamRouter.get("/", async (req, res) => {
  res.json(await steam.getStatus(req.userId));
});

// GET /api/steam/connect  → redirige a Steam para iniciar sesión (se abre como página, no con fetch)
steamRouter.get("/connect", (_req, res) => {
  if (!steamConfigured()) {
    res.redirect(`${env.APP_URL}/steam?error=${encodeURIComponent("Falta STEAM_API_KEY en backend/.env")}`);
    return;
  }
  // `state` aleatorio en una cookie: solo aceptamos la vuelta de Steam si lo trae
  const state = randomBytes(16).toString("hex");
  res.cookie(STATE_COOKIE, state, { httpOnly: true, sameSite: "lax", maxAge: 10 * 60 * 1000, path: "/api/steam" });
  res.redirect(steamLoginUrl(state));
});

// GET /api/steam/callback  → Steam vuelve aquí
steamRouter.get("/callback", async (req, res) => {
  const back = (params: string) => res.redirect(`${env.APP_URL}/steam?${params}`);
  try {
    const state = readCookie(req, STATE_COOKIE);
    res.clearCookie(STATE_COOKIE, { path: "/api/steam" });
    if (!state || req.query.state !== state) throw new HttpError(400, "La conexión caducó, vuelve a intentarlo");

    const steamId = await verifySteamLogin(req.query);
    await steam.connect(req.userId, steamId);
    back("connected=1");
  } catch (e) {
    if (!(e instanceof HttpError)) console.error(e);
    back(`error=${encodeURIComponent(e instanceof HttpError ? e.message : "No se pudo conectar con Steam")}`);
  }
});

steamRouter.delete("/", async (req, res) => {
  await steam.disconnect(req.userId);
  res.status(204).end();
});

// POST /api/steam/sync  → trae juegos, horas y logros (puede tardar)
steamRouter.post("/sync", async (req, res) => {
  res.json(await steam.sync(req.userId));
});

// GET /api/steam/games
steamRouter.get("/games", async (req, res) => {
  res.json(await steam.listGames(req.userId));
});

// GET /api/steam/achievements/:igdbId  → logros de un juego de tu lista (null si no está en Steam)
steamRouter.get("/achievements/:igdbId", async (req, res) => {
  const { igdbId } = igdbIdParam.parse(req.params);
  res.json(await steam.achievementsFor(req.userId, igdbId));
});

// POST /api/steam/import  { items: [{ appId, status }] }
steamRouter.post("/import", async (req, res) => {
  res.json(await steam.importGames(req.userId, importSchema.parse(req.body)));
});
