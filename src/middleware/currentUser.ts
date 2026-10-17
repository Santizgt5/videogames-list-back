import type { RequestHandler } from "express";
import { prisma } from "../lib/prisma.js";
import { env } from "../config/env.js";

let cachedUserId: number | null = null;

/**
 * Por ahora: siempre eres el usuario por defecto (DEFAULT_USER_EMAIL).
 * Cuando haya login, este middleware leerá el token/sesión y pondrá req.userId.
 * El resto del código ya filtra por req.userId, así que no tendrá que cambiar.
 */
export const currentUser: RequestHandler = async (req, _res, next) => {
  cachedUserId ??= await getDefaultUserId();
  req.userId = cachedUserId;
  next();
};

async function getDefaultUserId() {
  const user = await prisma.user.upsert({
    where: { email: env.DEFAULT_USER_EMAIL },
    update: {},
    create: { email: env.DEFAULT_USER_EMAIL, name: "Yo" },
  });
  return user.id;
}
