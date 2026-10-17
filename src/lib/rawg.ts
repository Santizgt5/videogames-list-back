import { env } from "../config/env.js";
import { HttpError } from "./httpError.js";

const BASE_URL = "https://api.rawg.io/api";

// Solo los campos de RAWG que usamos
interface RawgGame {
  id: number;
  slug: string;
  name: string;
  released: string | null;
  background_image: string | null;
  metacritic: number | null;
  rating: number;
  genres?: { name: string }[];
  platforms?: { platform: { name: string } }[] | null;
}

interface RawgGameDetail extends RawgGame {
  description_raw?: string;
  website?: string;
  developers?: { name: string }[];
  publishers?: { name: string }[];
}

interface RawgList<T> {
  count: number;
  next: string | null;
  results: T[];
}

/** Formato que devolvemos al frontend */
export interface GameSummary {
  id: number;
  slug: string;
  name: string;
  coverUrl: string | null;
  released: string | null;
  metacritic: number | null;
  rating: number;
  genres: string[];
  platforms: string[];
}

export interface GameDetail extends GameSummary {
  description: string;
  website: string | null;
  developers: string[];
  publishers: string[];
}

async function rawgFetch<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  if (!env.RAWG_API_KEY) {
    throw new HttpError(503, "Falta RAWG_API_KEY en backend/.env");
  }
  const url = new URL(BASE_URL + path);
  url.search = new URLSearchParams({ key: env.RAWG_API_KEY, ...params }).toString();

  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (res.status === 404) throw new HttpError(404, "Juego no encontrado en RAWG");
  if (!res.ok) throw new HttpError(502, `RAWG respondió ${res.status}`);
  return (await res.json()) as T;
}

function toSummary(g: RawgGame): GameSummary {
  return {
    id: g.id,
    slug: g.slug,
    name: g.name,
    coverUrl: g.background_image,
    released: g.released,
    metacritic: g.metacritic,
    rating: g.rating,
    genres: g.genres?.map((x) => x.name) ?? [],
    platforms: g.platforms?.map((x) => x.platform.name) ?? [],
  };
}

export async function searchGames(query: string, page = 1, pageSize = 20) {
  const data = await rawgFetch<RawgList<RawgGame>>("/games", {
    search: query,
    search_precise: "true",
    page: String(page),
    page_size: String(pageSize),
  });
  return {
    count: data.count,
    hasMore: data.next !== null,
    results: data.results.map(toSummary),
  };
}

export async function getGame(id: number): Promise<GameDetail> {
  const g = await rawgFetch<RawgGameDetail>(`/games/${id}`);
  return {
    ...toSummary(g),
    description: g.description_raw ?? "",
    website: g.website || null,
    developers: g.developers?.map((x) => x.name) ?? [],
    publishers: g.publishers?.map((x) => x.name) ?? [],
  };
}
