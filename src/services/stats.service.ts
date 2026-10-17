import { prisma } from "../lib/prisma.js";
import type { Achievement } from "../lib/steam.js";

const round1 = (n: number) => Math.round(n * 10) / 10;
/** YYYY-MM-DD en la zona horaria del servidor */
const localDate = (d: Date) => d.toLocaleDateString("en-CA");

export async function getStats(userId: number) {
  const [entries, steamGames, user] = await Promise.all([
    prisma.libraryEntry.findMany({
      where: { userId },
      select: {
        id: true,
        status: true,
        score: true,
        hoursPlayed: true,
        favorite: true,
        finishedAt: true,
        game: { select: { name: true, coverUrl: true, genres: true } },
      },
    }),
    prisma.steamGame.findMany({
      where: { userId },
      select: {
        appId: true,
        name: true,
        igdbId: true,
        igdbCoverUrl: true,
        achievementsTotal: true,
        achievementsUnlocked: true,
        achievements: true,
      },
    }),
    prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { steamId: true } }),
  ]);

  /* ---------- Totales ---------- */
  const scored = entries.filter((e) => e.score !== null);
  const totals = {
    games: entries.length,
    completed: entries.filter((e) => e.status === "COMPLETED").length,
    playing: entries.filter((e) => e.status === "PLAYING").length,
    favorites: entries.filter((e) => e.favorite).length,
    hours: round1(entries.reduce((n, e) => n + (e.hoursPlayed ?? 0), 0)),
    averageScore: scored.length ? round1(scored.reduce((n, e) => n + e.score!, 0) / scored.length) : null,
  };

  /* ---------- Terminados por año (según la fecha de terminado) ---------- */
  const byYear = new Map<number, { count: number; hours: number; games: string[] }>();
  for (const e of entries) {
    if (e.status !== "COMPLETED" || !e.finishedAt) continue;
    const year = e.finishedAt.getUTCFullYear(); // columna DATE: viene a medianoche UTC
    const y = byYear.get(year) ?? { count: 0, hours: 0, games: [] };
    y.count++;
    y.hours += e.hoursPlayed ?? 0;
    y.games.push(e.game.name);
    byYear.set(year, y);
  }
  const years = [...byYear.keys()];
  const completedByYear = years.length
    ? Array.from({ length: Math.max(...years) - Math.min(...years) + 1 }, (_, i) => {
        const year = Math.min(...years) + i;
        const y = byYear.get(year) ?? { count: 0, hours: 0, games: [] };
        return { year, count: y.count, hours: round1(y.hours), games: y.games };
      })
    : [];
  const completedWithoutDate = entries.filter((e) => e.status === "COMPLETED" && !e.finishedAt).length;

  /* ---------- Géneros (un juego cuenta en cada uno de sus géneros) ---------- */
  const genreMap = new Map<string, { games: number; hours: number; scoreSum: number; scored: number }>();
  for (const e of entries) {
    for (const genre of e.game.genres) {
      const g = genreMap.get(genre) ?? { games: 0, hours: 0, scoreSum: 0, scored: 0 };
      g.games++;
      g.hours += e.hoursPlayed ?? 0;
      if (e.score !== null) {
        g.scoreSum += e.score;
        g.scored++;
      }
      genreMap.set(genre, g);
    }
  }
  const genres = [...genreMap]
    .map(([genre, g]) => ({
      genre,
      games: g.games,
      hours: round1(g.hours),
      averageScore: g.scored ? round1(g.scoreSum / g.scored) : null,
    }))
    .sort((a, b) => b.hours - a.hours || b.games - a.games)
    .slice(0, 8);

  /* ---------- Notas 1-10 ---------- */
  const scores = Array.from({ length: 10 }, (_, i) => ({
    score: i + 1,
    count: scored.filter((e) => e.score === i + 1).length,
  }));

  /* ---------- Más jugados ---------- */
  const topHours = entries
    .filter((e) => (e.hoursPlayed ?? 0) > 0)
    .sort((a, b) => b.hoursPlayed! - a.hoursPlayed!)
    .slice(0, 10)
    .map((e) => ({ entryId: e.id, name: e.game.name, coverUrl: e.game.coverUrl, hours: e.hoursPlayed!, status: e.status }));

  return {
    totals,
    completedByYear,
    completedWithoutDate,
    genres,
    scores,
    topHours,
    steam: user.steamId ? steamStats(steamGames) : null,
  };
}

/* ---------- Steam: logros ---------- */

function steamStats(
  games: {
    appId: number;
    name: string;
    igdbCoverUrl: string | null;
    achievementsTotal: number;
    achievementsUnlocked: number;
    achievements: unknown;
  }[],
) {
  const withAch = games.filter((g) => g.achievementsTotal > 0);
  const unlocked = withAch.flatMap((g) =>
    ((g.achievements ?? []) as Achievement[]).filter((a) => a.unlocked).map((a) => ({ ...a, game: g.name })),
  );

  // Logros por mes, últimos 24 meses (incluido el actual)
  const now = new Date();
  const months = Array.from({ length: 24 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - 23 + i, 1);
    return localDate(d).slice(0, 7);
  });
  const perMonth = new Map(months.map((m) => [m, 0]));
  for (const a of unlocked) {
    if (!a.unlockedAt) continue;
    const m = localDate(new Date(a.unlockedAt)).slice(0, 7);
    if (perMonth.has(m)) perMonth.set(m, perMonth.get(m)! + 1);
  }

  const rarest = unlocked
    .filter((a) => a.percent !== null)
    .sort((a, b) => a.percent! - b.percent!)
    .slice(0, 8)
    .map((a) => ({
      game: a.game,
      name: a.name,
      description: a.description,
      icon: a.icon,
      percent: a.percent!,
      unlockedAt: a.unlockedAt,
    }));

  // Los que tienes más avanzados sin llegar al 100 %
  const closest = withAch
    .filter((g) => g.achievementsUnlocked > 0 && g.achievementsUnlocked < g.achievementsTotal)
    .sort(
      (a, b) =>
        b.achievementsUnlocked / b.achievementsTotal - a.achievementsUnlocked / a.achievementsTotal ||
        a.achievementsTotal - a.achievementsUnlocked - (b.achievementsTotal - b.achievementsUnlocked),
    )
    .slice(0, 6)
    .map((g) => ({
      appId: g.appId,
      name: g.name,
      coverUrl: g.igdbCoverUrl,
      unlocked: g.achievementsUnlocked,
      total: g.achievementsTotal,
    }));

  return {
    achievements: unlocked.length,
    perfectGames: withAch.filter((g) => g.achievementsUnlocked === g.achievementsTotal).length,
    gamesWithAchievements: withAch.length,
    achievementsByMonth: months.map((month) => ({ month, count: perMonth.get(month)! })),
    rarest,
    closest,
  };
}
