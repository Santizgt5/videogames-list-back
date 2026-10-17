import { app } from "./app.js";
import { env } from "./config/env.js";

// En Express 5 el callback de listen también recibe el error de arranque
app.listen(env.PORT, (err?: NodeJS.ErrnoException) => {
  if (err) {
    if (err.code === "EADDRINUSE") {
      console.error(
        `El puerto ${env.PORT} ya está ocupado. ¿Tienes otro backend corriendo? ` +
          `Ciérralo o cambia PORT en .env.`,
      );
    } else {
      console.error("No se pudo arrancar el servidor:", err);
    }
    process.exit(1);
  }

  console.log(`API escuchando en http://localhost:${env.PORT}`);
  if (!env.IGDB_CLIENT_ID || !env.IGDB_CLIENT_SECRET) {
    console.warn("Aviso: faltan las credenciales de IGDB, la búsqueda no funcionará.");
  }
});
