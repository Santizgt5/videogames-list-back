import { env } from "../config/env.js";
import { HttpError } from "./httpError.js";

const API = "https://api.steampowered.com";
const OPENID = "https://steamcommunity.com/openid/login";

/* ---------- Iniciar sesión con Steam (OpenID 2.0) ---------- */

export const steamCallbackUrl = () => `${env.APP_URL}/api/steam/callback`;

/** URL de Steam a la que mandamos al usuario. `state` vuelve en la URL de retorno. */
export function steamLoginUrl(state: string) {
  const params = new URLSearchParams({
    "openid.ns": "http://specs.openid.net/auth/2.0",
    "openid.mode": "checkid_setup",
    "openid.return_to": `${steamCallbackUrl()}?state=${state}`,
    "openid.realm": env.APP_URL,
    "openid.identity": "http://specs.openid.net/auth/2.0/identifier_select",
    "openid.claimed_id": "http://specs.openid.net/auth/2.0/identifier_select",
  });
  return `${OPENID}?${params}`;
}

/**
 * Comprueba con Steam que la respuesta es auténtica y devuelve el SteamID64.
 * Sin esto, cualquiera podría inventarse la URL de retorno con otro SteamID.
 */
export async function verifySteamLogin(query: Record<string, unknown>) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (k.startsWith("openid.") && typeof v === "string") params.set(k, v);

  if (params.get("openid.mode") !== "id_res") throw new HttpError(400, "Inicio de sesión con Steam cancelado");
  if (params.get("openid.op_endpoint") !== OPENID) throw new HttpError(400, "Respuesta de Steam inválida");
  if (!params.get("openid.return_to")?.startsWith(steamCallbackUrl())) {
    throw new HttpError(400, "Respuesta de Steam inválida");
  }
  const match = params.get("openid.claimed_id")?.match(/^https:\/\/steamcommunity\.com\/openid\/id\/(\d{17})$/);
  if (!match) throw new HttpError(400, "Respuesta de Steam inválida");

  params.set("openid.mode", "check_authentication");
  const res = await fetch(OPENID, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params,
    signal: AbortSignal.timeout(10_000),
  });
  const text = await res.text();
  if (!res.ok || !/^is_valid:true$/m.test(text)) throw new HttpError(401, "Steam no confirmó el inicio de sesión");
  return match[1]!;
}

/* ---------- Web API ---------- */

export const steamConfigured = () => Boolean(env.STEAM_API_KEY);

async function steamApi<T>(path: string, params: Record<string, string | number>): Promise<{ status: number; body: T | null }> {
  if (!steamConfigured()) throw new HttpError(503, "Falta STEAM_API_KEY en backend/.env");
  const url = new URL(`${API}/${path}`);
  url.search = new URLSearchParams({ key: env.STEAM_API_KEY, format: "json", ...params } as Record<string, string>).toString();

  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    // Steam corta si vamos muy rápido: esperamos y reintentamos un par de veces
    if (res.status === 429 && attempt < 3) {
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      continue;
    }
    if (res.status === 401 || res.status === 403) {
      // 403 en endpoints de usuario = perfil privado; en los demás = key mala
      return { status: res.status, body: null };
    }
    if (res.status === 429) throw new HttpError(429, "Steam está limitando las peticiones, prueba en unos minutos");
    return { status: res.status, body: (await res.json().catch(() => null)) as T | null };
  }
}

export interface SteamProfile {
  steamId: string;
  name: string;
  avatar: string;
  isPublic: boolean;
}

export async function getPlayerSummary(steamId: string): Promise<SteamProfile | null> {
  const { status, body } = await steamApi<{
    response: { players: { personaname: string; avatarfull: string; communityvisibilitystate: number }[] };
  }>("ISteamUser/GetPlayerSummaries/v2/", { steamids: steamId });
  if (status === 401 || status === 403) throw new HttpError(502, "Steam rechazó la API key. Revisa STEAM_API_KEY.");
  const p = body?.response.players[0];
  if (!p) return null;
  return { steamId, name: p.personaname, avatar: p.avatarfull, isPublic: p.communityvisibilitystate === 3 };
}

export interface OwnedGame {
  appid: number;
  name: string;
  playtime_forever: number; // minutos
  playtime_2weeks?: number;
  rtime_last_played?: number; // segundos unix, 0 = nunca
  has_community_visible_stats?: boolean;
}

/** null = Steam no deja ver los juegos (perfil o "detalles de juegos" privados) */
export async function getOwnedGames(steamId: string): Promise<OwnedGame[] | null> {
  const { status, body } = await steamApi<{ response: { games?: OwnedGame[] } }>("IPlayerService/GetOwnedGames/v1/", {
    steamid: steamId,
    include_appinfo: 1,
    include_played_free_games: 1,
  });
  if (status === 401) throw new HttpError(502, "Steam rechazó la API key. Revisa STEAM_API_KEY.");
  if (status === 403) return null;
  return body?.response.games ?? null;
}

export interface Achievement {
  apiName: string;
  name: string;
  description: string;
  icon: string;
  iconGray: string;
  hidden: boolean;
  unlocked: boolean;
  unlockedAt: string | null; // ISO; puede faltar aunque esté conseguido
  percent: number | null; // % de jugadores que lo tienen
}

/** Logros de un juego con los tuyos marcados. null si el juego no tiene logros o no se pueden leer. */
export async function getAchievements(steamId: string, appId: number): Promise<Achievement[] | null> {
  const [player, schema, global] = await Promise.all([
    steamApi<{
      playerstats: { success: boolean; achievements?: { apiname: string; achieved: number; unlocktime: number }[] };
    }>("ISteamUserStats/GetPlayerAchievements/v1/", { steamid: steamId, appid: appId }),
    steamApi<{
      game?: {
        availableGameStats?: {
          achievements?: {
            name: string;
            displayName: string;
            description?: string;
            icon: string;
            icongray: string;
            hidden: number;
          }[];
        };
      };
    }>("ISteamUserStats/GetSchemaForGame/v2/", { appid: appId, l: "spanish" }),
    steamApi<{ achievementpercentages?: { achievements: { name: string; percent: number | string }[] } }>(
      "ISteamUserStats/GetGlobalAchievementPercentagesForApp/v2/",
      { gameid: appId },
    ),
  ]);

  const mine = player.body?.playerstats.achievements;
  const defs = schema.body?.game?.availableGameStats?.achievements;
  if (!mine?.length || !defs?.length) return null;

  const unlocked = new Map(mine.filter((a) => a.achieved).map((a) => [a.apiname, a.unlocktime]));
  const percents = new Map(
    (global.body?.achievementpercentages?.achievements ?? []).map((a) => [a.name, Number(a.percent)]),
  );

  return defs.map((d) => {
    const time = unlocked.get(d.name);
    return {
      apiName: d.name,
      name: d.displayName,
      description: d.description ?? "",
      icon: d.icon,
      iconGray: d.icongray,
      hidden: d.hidden === 1,
      unlocked: time !== undefined,
      unlockedAt: time ? new Date(time * 1000).toISOString() : null,
      percent: percents.has(d.name) && Number.isFinite(percents.get(d.name)) ? percents.get(d.name)! : null,
    };
  });
}

/** Portada vertical de la tienda de Steam (para juegos que IGDB no conoce) */
export const steamCapsuleUrl = (appId: number) =>
  `https://shared.steamstatic.com/store_item_assets/steam/apps/${appId}/library_600x900.jpg`;
