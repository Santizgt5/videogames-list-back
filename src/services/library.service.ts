import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../lib/prisma.js";
import { HttpError } from "../lib/httpError.js";
import { getGame, type GameSummary } from "../lib/igdb.js";
import type { AddEntryInput, ListQuery, UpdateEntryInput } from "../schemas/library.schema.js";

const toDate = (d: string | null | undefined) =>
  d === undefined ? undefined : d === null ? null : new Date(d);

function entryData(input: UpdateEntryInput) {
  return {
    ...input,
    startedAt: toDate(input.startedAt),
    finishedAt: toDate(input.finishedAt),
  };
}

const includeGame = { game: true } as const;

function orderByFor(sort: ListQuery["sort"], order?: "asc" | "desc") {
  const dir = order ?? (sort === "name" ? "asc" : "desc");
  const nullsLast = { sort: dir, nulls: "last" } as const;
  switch (sort) {
    case "added":
      return { createdAt: dir };
    case "name":
      return { game: { name: dir } };
    case "score":
      return { score: nullsLast };
    case "hours":
      return { hoursPlayed: nullsLast };
    case "released":
      return { game: { released: nullsLast } };
    default:
      return { updatedAt: dir };
  }
}

export async function listEntries(userId: number, q: ListQuery) {
  return prisma.libraryEntry.findMany({
    where: {
      userId,
      status: q.status,
      favorite: q.favorite,
      game: q.q ? { name: { contains: q.q, mode: "insensitive" } } : undefined,
    },
    include: includeGame,
    orderBy: [orderByFor(q.sort, q.order), { id: "desc" }],
  });
}

export async function getEntry(userId: number, id: number) {
  const entry = await prisma.libraryEntry.findFirst({ where: { id, userId }, include: includeGame });
  if (!entry) throw new HttpError(404, "Entrada no encontrada");
  return entry;
}

/** Fila de nuestra tabla Game a partir de la info de IGDB */
export function gameRow(g: GameSummary) {
  return {
    slug: g.slug,
    name: g.name,
    coverUrl: g.coverUrl,
    backgroundUrl: g.backgroundUrl,
    released: g.released ? new Date(g.released) : null,
    criticScore: g.criticScore,
    genres: g.genres,
    platforms: g.platforms,
  };
}

/** Guarda (o refresca) la info del juego desde IGDB en nuestra tabla Game */
async function cacheGame(gameId: number) {
  const g = await getGame(gameId);
  const data = gameRow(g);
  return prisma.game.upsert({ where: { id: g.id }, update: data, create: { id: g.id, ...data } });
}

export async function addEntry(userId: number, input: AddEntryInput) {
  const { gameId, ...rest } = input;

  const existing = await prisma.libraryEntry.findUnique({
    where: { userId_gameId: { userId, gameId } },
  });
  if (existing) throw new HttpError(409, "Ese juego ya está en tu lista");

  await cacheGame(gameId);

  try {
    return await prisma.libraryEntry.create({
      data: { userId, gameId, ...entryData(rest) },
      include: includeGame,
    });
  } catch (e) {
    // Por si llegan dos peticiones a la vez
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      throw new HttpError(409, "Ese juego ya está en tu lista");
    }
    throw e;
  }
}

export async function updateEntry(userId: number, id: number, input: UpdateEntryInput) {
  await getEntry(userId, id); // comprueba que existe y es tuya
  return prisma.libraryEntry.update({
    where: { id },
    data: entryData(input),
    include: includeGame,
  });
}

export async function deleteEntry(userId: number, id: number) {
  await getEntry(userId, id);
  await prisma.libraryEntry.delete({ where: { id } });
}

export async function getStats(userId: number) {
  const [byStatus, totals, favorites] = await Promise.all([
    prisma.libraryEntry.groupBy({ by: ["status"], where: { userId }, _count: true }),
    prisma.libraryEntry.aggregate({
      where: { userId },
      _count: true,
      _avg: { score: true },
      _sum: { hoursPlayed: true },
    }),
    prisma.libraryEntry.count({ where: { userId, favorite: true } }),
  ]);

  return {
    total: totals._count,
    favorites,
    averageScore: totals._avg.score === null ? null : Math.round(totals._avg.score * 10) / 10,
    totalHours: totals._sum.hoursPlayed ?? 0,
    byStatus: Object.fromEntries(byStatus.map((s) => [s.status, s._count])),
  };
}

/** Para marcar en la búsqueda qué juegos ya tienes */
export async function entriesForGames(userId: number, gameIds: number[]) {
  const entries = await prisma.libraryEntry.findMany({
    where: { userId, gameId: { in: gameIds } },
    select: { id: true, gameId: true, status: true },
  });
  return new Map(entries.map((e) => [e.gameId, { id: e.id, status: e.status }]));
}
