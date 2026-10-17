import { app } from "./app.js";
import { env } from "./config/env.js";

app.listen(env.PORT, () => {
  console.log(`API escuchando en http://localhost:${env.PORT}`);
  if (!env.RAWG_API_KEY) console.warn("Aviso: falta RAWG_API_KEY, la búsqueda no funcionará.");
});
