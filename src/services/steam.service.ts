import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../lib/prisma.js";
import { HttpError } from "../lib/httpError.js";
import { getGamesByIds, igdbGamesForSteamApps } from "../lib/igdb.js";
import {
  getAchievements,
  getOwnedGames,
  getPlayerSummary,
  steamCapsuleUrl,
  steamConfigured,
  type Achievement,
  type OwnedGame,
} from "../lib/steam.js";
import type { ImportInput } from "../schemas/steam.schema.js";
import { gameRow } from "./library.service.js";

/** Plataforma que ponemos a lo importado (mismo nombre que usa IGDB) */
const STEAM_PLATFORM = "PC (Microsoft Windows)";

const toHours = (minutes: number) => Math.round((minutes / 60) * 10) / 10;

export async function getStatus(userId: number) {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { steamId: true, steamName: true, steamAvatar: true, steamSyncedAt: true },
  });
  return {
    configured: steamConfigured(),
    connected: Boolean(user.steamId),
    steamId: user.steamId,
    name: user.steamName,
    avatar: user.steamAvatar,
    syncedAt: user.steamSyncedAt,
  };
}

export async function connect(userId: number, steamId: string) {
  const owner = await prisma.user.findUnique({ where: { steamId }, select: { id: true } });
  if (owner && owner.id !== userId) throw new HttpError(409, "Esa cuenta de Steam ya está enlazada a otro usuario");

  const profile = await getPlayerSummary(steamId);
  await prisma.user.update({
    where: { id: userId },
    data: { steamId, steamName: profile?.name ?? null, steamAvatar: profile?.avatar ?? null },
  });
}

export async function disconnect(userId: number) {
  await prisma.$transaction([
    prisma.steamGame.deleteMany({ where: { userId } }),
    prisma.user.update({
      where: { id: userId },
      data: { steamId: null, steamName: null, steamAvatar: null, steamSyncedAt: null },
    }),
  ]);
}

/* ---------- Sincronizar ---------- */

const syncing = new Set<number>();

/** Ejecuta `fn` sobre cada elemento con como mucho `limit` a la vez */
async function pool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  let i = 0;
  const worker = async () => {
    while (i < items.length) await fn(items[i++]!);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

export async function sync(userId: number) {
  if (syncing.has(userId)) throw new HttpError(409, "Ya se está sincronizando, espera un momento");
  syncing.add(userId);
  try {
    return await doSync(userId);
  } finally {
    syncing.delete(userId);
  }
}

async function doSync(userId: number) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (!user.steamId) throw new HttpError(400, "Primero conecta tu cuenta de Steam");
  const steamId = user.steamId;

  // Nombre y avatar pueden haber cambiado
  const profile = await getPlayerSummary(steamId);

  const owned = await getOwnedGames(steamId);
  if (!owned) {
    throw new HttpError(
      400,
      "Steam no deja ver tus juegos. En Steam ve a Perfil > Editar perfil > Privacidad y pon «Detalles de juegos» en Público.",
    );
  }

  const igdb = await igdbGamesForSteamApps(owned.map((g) => g.appid));
  const existing = new Map(
    (await prisma.steamGame.findMany({ where: { userId }, select: { appId: true, achievementsSyncedAt: true } })).map(
      (g) => [g.appId, g],
    ),
  );

  const lastPlayed = (g: OwnedGame) => (g.rtime_last_played ? new Date(g.rtime_last_played * 1000) : null);

  // 1. Juegos y horas
  const upserts = owned.map((g) => {
    const match = igdb.get(g.appid);
    const data = {
      name: g.name,
      playtimeMinutes: g.playtime_forever,
      playtime2Weeks: g.playtime_2weeks ?? 0,
      lastPlayedAt: lastPlayed(g),
      igdbId: match?.igdbId ?? null,
      igdbCoverUrl: match?.coverUrl ?? null,
    };
    return prisma.steamGame.upsert({
      where: { userId_appId: { userId, appId: g.appid } },
      update: data,
      create: { userId, appId: g.appid, ...data },
    });
  });
  for (let i = 0; i < upserts.length; i += 200) await prisma.$transaction(upserts.slice(i, i + 200));

  // 2. Logros: solo de juegos jugados que tienen logros y que has jugado desde la última vez
  const toCheck = owned.filter((g) => {
    if (g.playtime_forever === 0 || !g.has_community_visible_stats) return false;
    const checked = existing.get(g.appid)?.achievementsSyncedAt;
    const played = lastPlayed(g);
    return !checked || (played !== null && played > checked);
  });

  let failed = 0;
  await pool(toCheck, 4, async (g) => {
    let list: Achievement[] | null;
    try {
      list = await getAchievements(steamId, g.appid);
    } catch {
      failed++;
      return;
    }
    await prisma.steamGame.update({
      where: { userId_appId: { userId, appId: g.appid } },
      data: {
        achievements: list ? (list as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
        achievementsTotal: list?.length ?? 0,
        achievementsUnlocked: list?.filter((a) => a.unlocked).length ?? 0,
        achievementsSyncedAt: new Date(),
      },
    });
  });

  // 3. Horas y fechas de los juegos que ya están en tu lista
  const entriesUpdated = await fillEntriesFromSteam(userId);

  await prisma.user.update({
    where: { id: userId },
    data: {
      steamSyncedAt: new Date(),
      ...(profile && { steamName: profile.name, steamAvatar: profile.avatar }),
    },
  });

  return {
    games: owned.length,
    played: owned.filter((g) => g.playtime_forever > 0).length,
    matched: igdb.size,
    achievementsChecked: toCheck.length - failed,
    achievementsFailed: failed,
    entriesUpdated,
  };
}

/* ---------- Consultar ---------- */

export async function listGames(userId: number) {
  const games = await prisma.steamGame.findMany({
    where: { userId },
    omit: { achievements: true },
    orderBy: [{ playtimeMinutes: "desc" }, { name: "asc" }],
  });
  const entries = await prisma.libraryEntry.findMany({
    where: { userId, gameId: { in: games.flatMap((g) => (g.igdbId ? [g.igdbId] : [])) } },
    select: { id: true, gameId: true, status: true },
  });
  const byGame = new Map(entries.map((e) => [e.gameId, { id: e.id, status: e.status }]));

  return games.map(({ userId: _, ...g }) => ({
    ...g,
    hours: toHours(g.playtimeMinutes),
    capsuleUrl: steamCapsuleUrl(g.appId),
    libraryEntry: g.igdbId ? (byGame.get(g.igdbId) ?? null) : null,
  }));
}

/** Logros de Steam de un juego de tu lista (por id de IGDB), o null */
export async function achievementsFor(userId: number, igdbId: number) {
  const g = await prisma.steamGame.findFirst({
    where: { userId, igdbId },
    orderBy: { playtimeMinutes: "desc" },
    select: {
      appId: true,
      name: true,
      playtimeMinutes: true,
      achievementsTotal: true,
      achievementsUnlocked: true,
      achievements: true,
    },
  });
  if (!g) return null;
  return { ...g, hours: toHours(g.playtimeMinutes), achievements: (g.achievements ?? []) as unknown as Achievement[] };
}

/* ---------- Importar a la lista ---------- */

export async function importGames(userId: number, { items }: ImportInput) {
  const steamGames = await prisma.steamGame.findMany({
    where: { userId, appId: { in: items.map((i) => i.appId) }, igdbId: { not: null } },
  });
  const already = new Set(
    (
      await prisma.libraryEntry.findMany({
        where: { userId, gameId: { in: steamGames.map((g) => g.igdbId!) } },
        select: { gameId: true },
      })
    ).map((e) => e.gameId),
  );

  // Un juego de IGDB solo una vez (dos appIds pueden apuntar al mismo)
  const statusByApp = new Map(items.map((i) => [i.appId, i.status]));
  const toAdd = new Map<number, (typeof steamGames)[number]>();
  for (const g of steamGames) if (!already.has(g.igdbId!) && !toAdd.has(g.igdbId!)) toAdd.set(g.igdbId!, g);
  if (toAdd.size === 0) return { added: 0 };

  // Guardamos la info de IGDB de todos de una vez (no uno a uno)
  const ids = [...toAdd.keys()];
  const infos = (await Promise.all(Array.from({ length: Math.ceil(ids.length / 500) }, (_, i) => getGamesByIds(ids.slice(i * 500, i * 500 + 500))))).flat();
  await prisma.$transaction(
    infos.map((g) => prisma.game.upsert({ where: { id: g.id }, update: gameRow(g), create: { id: g.id, ...gameRow(g) } })),
  );
  const known = new Set(infos.map((g) => g.id));

  const result = await prisma.libraryEntry.createMany({
    data: [...toAdd.values()]
      .filter((g) => known.has(g.igdbId!))
      .map((g) => ({
        userId,
        gameId: g.igdbId!,
        status: statusByApp.get(g.appId)!,
        hoursPlayed: g.playtimeMinutes > 0 ? toHours(g.playtimeMinutes) : null,
        platform: STEAM_PLATFORM,
      })),
    skipDuplicates: true,
  });
  await fillEntriesFromSteam(userId);
  return { added: result.count };
}

/* ---------- Rellenar la lista con datos de Steam ---------- */

/** Fecha (YYYY-MM-DD en la zona horaria del servidor) lista para una columna @db.Date */
function dateOnly(iso: string) {
  return new Date(new Date(iso).toLocaleDateString("en-CA"));
}

/** Primer y último logro conseguidos (con fecha) */
function achievementRange(achievements: Achievement[]) {
  const times = achievements
    .flatMap((a) => (a.unlockedAt ? [a.unlockedAt] : []))
    .sort();
  return times.length ? { first: dateOnly(times[0]!), last: dateOnly(times.at(-1)!) } : null;
}

const FINISHED_STATUSES = new Set(["COMPLETED", "DROPPED"]);

/**
 * Actualiza las entradas de tu lista que están en Steam:
 * - Horas: solo suben (por si también juegas fuera de Steam).
 * - Empezado: fecha del primer logro, si está vacío.
 * - Terminado (Completado/Abandonado): fecha del último logro, si está vacío.
 * Nunca pisa fechas que hayas puesto a mano. Devuelve cuántas entradas cambiaron.
 */
async function fillEntriesFromSteam(userId: number) {
  const steamGames = await prisma.steamGame.findMany({
    where: { userId, igdbId: { not: null } },
    select: { igdbId: true, playtimeMinutes: true, achievements: true },
  });
  // Varias versiones en Steam pueden ser el mismo juego en IGDB (p. ej. Metro Exodus y su Enhanced Edition):
  // se suman las horas y se juntan los logros
  const byGame = new Map<number, { playtimeMinutes: number; achievements: Achievement[] }>();
  for (const g of steamGames) {
    const acc = byGame.get(g.igdbId!) ?? { playtimeMinutes: 0, achievements: [] };
    acc.playtimeMinutes += g.playtimeMinutes;
    acc.achievements.push(...((g.achievements ?? []) as unknown as Achievement[]));
    byGame.set(g.igdbId!, acc);
  }

  const entries = await prisma.libraryEntry.findMany({
    where: { userId, gameId: { in: [...byGame.keys()] } },
    select: { id: true, gameId: true, status: true, hoursPlayed: true, startedAt: true, finishedAt: true },
  });

  const updates = entries.flatMap((e) => {
    const g = byGame.get(e.gameId)!;
    const range = achievementRange(g.achievements);
    const data: { hoursPlayed?: number; startedAt?: Date; finishedAt?: Date } = {};

    const hours = toHours(g.playtimeMinutes);
    if (hours > (e.hoursPlayed ?? 0)) data.hoursPlayed = hours;

    // No ponemos un inicio posterior al fin (ni al revés) si una de las dos la pusiste tú
    if (range && !e.startedAt && !(e.finishedAt && range.first > e.finishedAt)) data.startedAt = range.first;
    const start = data.startedAt ?? e.startedAt;
    if (range && !e.finishedAt && FINISHED_STATUSES.has(e.status) && !(start && range.last < start)) {
      data.finishedAt = range.last;
    }

    return Object.keys(data).length ? [prisma.libraryEntry.update({ where: { id: e.id }, data })] : [];
  });
  await prisma.$transaction(updates);
  return updates.length;
}
