# videogames-list-back

API de **Backlog**, una lista personal de videojuegos (estilo MyAnimeList): busca juegos, añádelos a tu lista, marca su estado y ponles nota, horas y notas.

**Stack**: Node + Express 5 + TypeScript + Prisma 7 + PostgreSQL (Docker) + Zod.
Los datos de los juegos vienen de la [API de RAWG](https://rawg.io/apidocs).

## Puesta en marcha

Requisitos: Node 20+ y Docker.

```bash
cp .env.example .env        # y pon tu RAWG_API_KEY
docker compose up -d        # PostgreSQL en localhost:5432
npm install                 # también genera el cliente de Prisma
npx prisma migrate deploy   # crea las tablas
npm run dev                 # http://localhost:3000
```

## Variables de entorno

| Variable | Descripción |
|---|---|
| `DATABASE_URL` | Conexión a Postgres (por defecto la del `docker-compose.yml`) |
| `PORT` | Puerto de la API (3000) |
| `CORS_ORIGIN` | URL del frontend (http://localhost:5173) |
| `RAWG_API_KEY` | Key gratuita de https://rawg.io/apidocs |
| `DEFAULT_USER_EMAIL` | Usuario único mientras no haya login |

## Endpoints

| Método | Ruta | Qué hace |
|---|---|---|
| GET | `/api/health` | Estado del servidor |
| GET | `/api/games/search?q=zelda&page=1` | Busca en RAWG y marca los que ya tienes |
| GET | `/api/games/:rawgId` | Detalle de un juego |
| GET | `/api/library?status=&favorite=&q=&sort=&order=` | Tu lista. `sort`: updated, added, name, score, hours, released |
| GET | `/api/library/stats` | Totales, nota media, horas y conteo por estado |
| GET | `/api/library/:id` | Una entrada de tu lista |
| POST | `/api/library` | Añadir: `{ gameId, status?, score?, hoursPlayed?, platform?, startedAt?, finishedAt?, notes?, favorite? }` |
| PATCH | `/api/library/:id` | Editar cualquiera de esos campos |
| DELETE | `/api/library/:id` | Quitar de la lista |

Estados: `PLAYING`, `COMPLETED`, `PLAN_TO_PLAY`, `ON_HOLD`, `DROPPED`. Nota de 1 a 10. Fechas en formato `YYYY-MM-DD`.

## Estructura

```
prisma/schema.prisma      Modelos: User, Game (caché de RAWG), LibraryEntry
src/
  app.ts                  Configuración de Express y rutas
  config/env.ts           Validación de variables de entorno
  lib/rawg.ts             Cliente de la API de RAWG
  middleware/             Usuario actual y manejo de errores
  routes/                 /api/games y /api/library
  schemas/                Validación de entrada con Zod
  services/               Lógica de la lista
```

## Scripts

- `npm run dev`: servidor con recarga automática
- `npm run db:migrate`: crea una migración después de cambiar `prisma/schema.prisma`
- `npm run db:studio`: Prisma Studio para ver y editar la BD
- `npm run typecheck`: comprueba los tipos
- `npm run build` / `npm start`: compilar y ejecutar en producción

## Preparado para login

Ya existe la tabla `User` y cada entrada de la lista pertenece a un usuario.
Ahora mismo `src/middleware/currentUser.ts` te asigna siempre al usuario por defecto.
Para añadir login solo hay que cambiar ese middleware para que lea el token o la sesión y ponga `req.userId`.
