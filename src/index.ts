import { app } from "./app.js";
import { env } from "./config/env.js";

app.listen(env.PORT, () => {
  console.log(`API escuchando en http://localhost:${env.PORT}`);
  if (!env.IGDB_CLIENT_ID || !env.IGDB_CLIENT_SECRET) {
    console.warn("Aviso: faltan las credenciales de IGDB, la búsqueda no funcionará.");
  }
});
