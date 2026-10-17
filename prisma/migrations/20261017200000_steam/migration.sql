-- Conexión con Steam
ALTER TABLE "User" ADD COLUMN "steamId" TEXT;
ALTER TABLE "User" ADD COLUMN "steamName" TEXT;
ALTER TABLE "User" ADD COLUMN "steamAvatar" TEXT;
ALTER TABLE "User" ADD COLUMN "steamSyncedAt" TIMESTAMP(3);
CREATE UNIQUE INDEX "User_steamId_key" ON "User"("steamId");

CREATE TABLE "SteamGame" (
    "userId" INTEGER NOT NULL,
    "appId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "playtimeMinutes" INTEGER NOT NULL,
    "playtime2Weeks" INTEGER NOT NULL DEFAULT 0,
    "lastPlayedAt" TIMESTAMP(3),
    "igdbId" INTEGER,
    "igdbCoverUrl" TEXT,
    "achievementsTotal" INTEGER NOT NULL DEFAULT 0,
    "achievementsUnlocked" INTEGER NOT NULL DEFAULT 0,
    "achievements" JSONB,
    "achievementsSyncedAt" TIMESTAMP(3),
    CONSTRAINT "SteamGame_pkey" PRIMARY KEY ("userId","appId")
);
CREATE INDEX "SteamGame_userId_igdbId_idx" ON "SteamGame"("userId", "igdbId");
ALTER TABLE "SteamGame" ADD CONSTRAINT "SteamGame_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
