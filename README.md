# videogames-list-back

API de **Backlog**, una lista personal de videojuegos (estilo MyAnimeList): busca juegos, añádelos a tu lista, marca su estado y ponles nota, horas y notas.

**Stack**: Node + Express 5 + TypeScript + Prisma 7 + PostgreSQL (Docker) + Zod.
Los datos y portadas de los juegos vienen de [IGDB](https://api-docs.igdb.com/) (Twitch).

## Credenciales de IGDB

1. Activa la verificación en dos pasos en tu cuenta de Twitch.
2. Registra una aplicación en https://dev.twitch.tv/console/apps (redirect URL: `http://localhost`, categoría: Application Integration, tipo: Confidential).
3. Copia el Client ID y genera un Client Secret.

El backend pide y renueva solo el token de acceso.

## Puesta en marcha

Requisitos: Node 20+ y Docker.

```bash
cp .env.example .env        # y pon tus credenciales de IGDB
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
| `IGDB_CLIENT_ID` | Client ID de tu app en https://dev.twitch.tv/console/apps |
| `IGDB_CLIENT_SECRET` | Client Secret de esa misma app |
| `STEAM_API_KEY` | API key de Steam (https://steamcommunity.com/dev/apikey). Opcional: sin ella no hay conexión con Steam |
| `APP_URL` | URL del frontend en el navegador (http://localhost:5173). Steam vuelve aquí tras iniciar sesión |

## Endpoints

| Método | Ruta | Qué hace |
|---|---|---|
| GET | `/api/health` | Estado del servidor |
| POST | `/api/auth/register` | Crear cuenta: `{ email, username, password }`. Deja la sesión iniciada |
| POST | `/api/auth/login` | Entrar: `{ login, password }` (`login` = correo o usuario) |
| POST | `/api/auth/logout` | Cerrar sesión |
| GET | `/api/auth/me` | Usuario con sesión, o 401 |
| GET | `/api/games/search?q=zelda&page=1` | Busca en IGDB y marca los que ya tienes |
| GET | `/api/games/:igdbId` | Detalle de un juego (resumen, desarrolladora, editora) |
| GET | `/api/library?status=&favorite=&q=&sort=&order=` | Tu lista. `sort`: updated, added, name, score, hours, released |
| GET | `/api/library/stats` | Totales, nota media, horas y conteo por estado |
| GET | `/api/library/:id` | Una entrada de tu lista |
| POST | `/api/library` | Añadir: `{ gameId, status?, score?, hoursPlayed?, platform?, startedAt?, finishedAt?, notes?, favorite? }` |
| PATCH | `/api/library/:id` | Editar cualquiera de esos campos |
| DELETE | `/api/library/:id` | Quitar de la lista |
| GET | `/api/steam` | Estado de la conexión con Steam |
| GET | `/api/steam/connect` | Redirige a Steam para iniciar sesión (se abre como página) |
| GET | `/api/steam/callback` | Vuelta desde Steam: verifica el inicio de sesión y enlaza la cuenta |
| DELETE | `/api/steam` | Desconectar Steam (borra los datos traídos de Steam, no tu lista) |
| POST | `/api/steam/sync` | Trae juegos, horas y logros. Sube las horas de tu lista si Steam tiene más |
| GET | `/api/steam/games` | Tus juegos de Steam con horas, logros y si ya están en tu lista |
| GET | `/api/steam/achievements/:igdbId` | Logros de Steam de un juego, o `null` |
| POST | `/api/steam/import` | Añadir a la lista: `{ items: [{ appId, status }] }` |

Todo lo de `/api/games`, `/api/library` y `/api/steam` necesita sesión (si no, responde 401).

Estados: `PLAYING`, `COMPLETED`, `PLAN_TO_PLAY`, `ON_HOLD`, `DROPPED`. Nota de 1 a 10. Fechas en formato `YYYY-MM-DD`.

## Estructura

```
prisma/schema.prisma      Modelos: User, Session, Game (caché de IGDB), LibraryEntry, SteamGame
src/
  app.ts                  Configuración de Express y rutas
  config/env.ts           Validación de variables de entorno
  lib/igdb.ts             Cliente de IGDB (incluye el token de Twitch)
  lib/password.ts         Hash de contraseñas con scrypt
  lib/steam.ts            Web API de Steam e inicio de sesión con Steam (OpenID)
  middleware/             Sesión (cookie) y manejo de errores
  routes/                 /api/auth, /api/games, /api/library y /api/steam
  schemas/                Validación de entrada con Zod
  services/               Lógica de la lista y de las cuentas
```

## Scripts

- `npm run dev`: servidor con recarga automática
- `npm run db:migrate`: crea una migración después de cambiar `prisma/schema.prisma`
- `npm run db:studio`: Prisma Studio para ver y editar la BD
- `npm run typecheck`: comprueba los tipos
- `npm run build` / `npm start`: compilar y ejecutar en producción

## Login

- Usuario (3-20 letras, números o `_`), correo y contraseña (mínimo 8). Usuario y correo se guardan en minúsculas.
- Las contraseñas se guardan con `scrypt` (sal aleatoria), nunca en claro.
- Al entrar se crea una fila en `Session` y su id va en la cookie `sid` (httpOnly, 30 días). Cerrar sesión borra la fila.
- La lista que existía antes del login (usuario sin contraseña) pasa a la primera cuenta que se registre.

## Steam

1. Pide una API key en https://steamcommunity.com/dev/apikey (dominio: `localhost`; Steam exige que la cuenta haya gastado al menos 5 USD) y ponla en `STEAM_API_KEY`.
2. En Steam: Editar perfil > Privacidad > **Detalles de juegos: Público**. Si no, Steam no devuelve tus juegos.

Cómo funciona:
- **Conectar**: inicio de sesión con Steam (OpenID 2.0). Steam nos da tu SteamID64 y lo verificamos con Steam (`check_authentication`) antes de guardarlo. Un `state` aleatorio en cookie evita que otra web te enlace una cuenta ajena.
- **Sincronizar**: `GetOwnedGames` (juegos y minutos jugados) y, para cada juego jugado con logros, `GetPlayerAchievements` + `GetSchemaForGame` (nombres e iconos en español) + `GetGlobalAchievementPercentagesForApp` (rareza). Los logros solo se vuelven a pedir si has jugado ese juego desde la última vez.
- **Emparejar con IGDB**: con `external_games` (fuente 1 = Steam) se pasa del appId de Steam al juego de IGDB, con portada incluida.
- **Importar**: crea las entradas con las horas de Steam y plataforma `PC (Microsoft Windows)`.
