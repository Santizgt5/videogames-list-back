import { env } from "../config/env.js";
import { HttpError } from "./httpError.js";

const API_URL = "https://api.igdb.com/v4";
const TOKEN_URL = "https://id.twitch.tv/oauth2/token";

// Solo juegos "de verdad": principal, expansión independiente, remake, remaster, edición ampliada y port.
// Deja fuera DLCs, mods, packs, episodios, etc.
const GAME_TYPES = "(0,4,8,9,10,11)";

/* ---------- Token de Twitch (se pide una vez y se renueva solo) ---------- */

let token: { value: string; expiresAt: number } | null = null;

async function getToken(forceRefresh = false): Promise<string> {
  if (!env.IGDB_CLIENT_ID || !env.IGDB_CLIENT_SECRET) {
    throw new HttpError(503, "Faltan IGDB_CLIENT_ID / IGDB_CLIENT_SECRET en backend/.env");
  }
  if (!forceRefresh && token && Date.now() < token.expiresAt) return token.value;

  const url = new URL(TOKEN_URL);
  url.search = new URLSearchParams({
    client_id: env.IGDB_CLIENT_ID,
    client_secret: env.IGDB_CLIENT_SECRET,
    grant_type: "client_credentials",
  }).toString();

  const res = await fetch(url, { method: "POST", signal: AbortSignal.timeout(10_000) });
  if (!res.ok) {
    throw new HttpError(502, `Twitch rechazó las credenciales de IGDB (${res.status}). Revisa el Client ID y el Secret.`);
  }
  const data = (await res.json()) as { access_token: string; expires_in: number };
  // Lo renovamos 5 minutos antes de que caduque
  token = { value: data.access_token, expiresAt: Date.now() + (data.expires_in - 300) * 1000 };
  return token.value;
}

/** Hace una consulta a IGDB. `body` usa su lenguaje de consultas (Apicalypse). */
async function igdb<T>(endpoint: string, body: string, retried = false): Promise<T> {
  const res = await fetch(`${API_URL}/${endpoint}`, {
    method: "POST",
    headers: {
      "Client-ID": env.IGDB_CLIENT_ID,
      Authorization: `Bearer ${await getToken(retried)}`,
      Accept: "application/json",
    },
    body,
    signal: AbortSignal.timeout(10_000),
  });
  // Token caducado o revocado: lo pedimos de nuevo una vez
  if (res.status === 401 && !retried) return igdb<T>(endpoint, body, true);
  if (res.status === 429) throw new HttpError(429, "Demasiadas búsquedas seguidas, espera un segundo");
  if (!res.ok) throw new HttpError(502, `IGDB respondió ${res.status}: ${await res.text()}`);
  return (await res.json()) as T;
}

/* ---------- Tipos ---------- */

interface IgdbImage {
  image_id: string;
}

interface IgdbGame {
  id: number;
  slug: string;
  name: string;
  first_release_date?: number; // segundos unix
  cover?: IgdbImage;
  artworks?: IgdbImage[];
  screenshots?: IgdbImage[];
  genres?: { name: string }[];
  platforms?: { name: string; abbreviation?: string }[];
  aggregated_rating?: number;
  summary?: string;
  url?: string;
  involved_companies?: { company: { name: string }; developer: boolean; publisher: boolean }[];
}

/** Formato que devolvemos al frontend */
export interface GameSummary {
  id: number;
  slug: string;
  name: string;
  coverUrl: string | null;
  backgroundUrl: string | null;
  released: string | null; // YYYY-MM-DD
  criticScore: number | null; // 0-100
  genres: string[];
  platforms: string[];
}

export interface GameDetail extends GameSummary {
  summary: string;
  igdbUrl: string | null;
  developers: string[];
  publishers: string[];
}

/* ---------- Conversión ---------- */

// Tamaños: https://api-docs.igdb.com/#images
export const imageUrl = (imageId: string, size: string) =>
  `https://images.igdb.com/igdb/image/upload/t_${size}/${imageId}.jpg`;

const SUMMARY_FIELDS = [
  "name",
  "slug",
  "first_release_date",
  "cover.image_id",
  "artworks.image_id",
  "screenshots.image_id",
  "genres.name",
  "platforms.name",
  "aggregated_rating",
].join(",");

const DETAIL_FIELDS = [
  SUMMARY_FIELDS,
  "summary",
  "url",
  "involved_companies.company.name",
  "involved_companies.developer",
  "involved_companies.publisher",
].join(",");

function toSummary(g: IgdbGame): GameSummary {
  const background = g.artworks?.[0] ?? g.screenshots?.[0];
  return {
    id: g.id,
    slug: g.slug,
    name: g.name,
    coverUrl: g.cover ? imageUrl(g.cover.image_id, "cover_big") : null,
    backgroundUrl: background ? imageUrl(background.image_id, "screenshot_big") : null,
    released: g.first_release_date
      ? new Date(g.first_release_date * 1000).toISOString().slice(0, 10)
      : null,
    criticScore: g.aggregated_rating ? Math.round(g.aggregated_rating) : null,
    genres: g.genres?.map((x) => x.name) ?? [],
    platforms: g.platforms?.map((x) => x.name) ?? [],
  };
}

/* ---------- API pública ---------- */

const escape = (s: string) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

export async function searchGames(query: string, page = 1, pageSize = 20) {
  // Pedimos uno de más para saber si hay otra página
  const results = await igdb<IgdbGame[]>(
    "games",
    `search "${escape(query)}";
     fields ${SUMMARY_FIELDS};
     where game_type = ${GAME_TYPES} & version_parent = null;
     limit ${pageSize + 1}; offset ${(page - 1) * pageSize};`,
  );
  return {
    hasMore: results.length > pageSize,
    results: results.slice(0, pageSize).map(toSummary),
  };
}

export async function getGame(id: number): Promise<GameDetail> {
  const [g] = await igdb<IgdbGame[]>("games", `fields ${DETAIL_FIELDS}; where id = ${id};`);
  if (!g) throw new HttpError(404, "Juego no encontrado en IGDB");
  const companies = g.involved_companies ?? [];
  return {
    ...toSummary(g),
    summary: g.summary ?? "",
    igdbUrl: g.url ?? null,
    developers: companies.filter((c) => c.developer).map((c) => c.company.name),
    publishers: companies.filter((c) => c.publisher).map((c) => c.company.name),
  };
}

/** Varios juegos por id en una sola consulta (máx. 500) */
export async function getGamesByIds(ids: number[]): Promise<GameSummary[]> {
  if (ids.length === 0) return [];
  const games = await igdb<IgdbGame[]>(
    "games",
    `fields ${SUMMARY_FIELDS}; where id = (${ids.join(",")}); limit 500;`,
  );
  return games.map(toSummary);
}

const STEAM_SOURCE = 1; // external_game_sources: 1 = Steam

/** appId de Steam -> juego de IGDB (id y portada). Los que IGDB no conoce no aparecen. */
export async function igdbGamesForSteamApps(appIds: number[]) {
  const map = new Map<number, { igdbId: number; coverUrl: string | null }>();
  for (let i = 0; i < appIds.length; i += 500) {
    const chunk = appIds.slice(i, i + 500);
    const rows = await igdb<{ uid: string; game?: { id: number; cover?: IgdbImage } }[]>(
      "external_games",
      `fields uid, game.id, game.cover.image_id;
       where external_game_source = ${STEAM_SOURCE} & uid = (${chunk.map((id) => `"${id}"`).join(",")});
       limit 500;`,
    );
    for (const r of rows) {
      const appId = Number(r.uid);
      // Un appId puede salir varias veces (ediciones); nos quedamos con el primero
      if (!r.game || map.has(appId)) continue;
      map.set(appId, {
        igdbId: r.game.id,
        coverUrl: r.game.cover ? imageUrl(r.game.cover.image_id, "cover_big") : null,
      });
    }
  }
  return map;
}
