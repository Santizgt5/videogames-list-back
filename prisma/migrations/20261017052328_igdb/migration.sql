-- Cambio de RAWG a IGDB
ALTER TABLE "Game" RENAME COLUMN "metacritic" TO "criticScore";
ALTER TABLE "Game" ADD COLUMN "backgroundUrl" TEXT;
