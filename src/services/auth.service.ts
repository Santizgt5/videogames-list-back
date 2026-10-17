import { randomBytes } from "node:crypto";
import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../lib/prisma.js";
import { HttpError } from "../lib/httpError.js";
import { hashPassword, verifyPassword } from "../lib/password.js";
import type { LoginInput, RegisterInput } from "../schemas/auth.schema.js";

export const SESSION_DAYS = 30;

const publicUser = { id: true, email: true, username: true, createdAt: true } as const;

export async function register({ email, username, password }: RegisterInput) {
  const taken = await prisma.user.findFirst({
    where: { OR: [{ email }, { username }] },
    select: { email: true },
  });
  if (taken) {
    throw new HttpError(409, taken.email === email ? "Ese correo ya tiene cuenta" : "Ese usuario ya existe");
  }

  const data = { email, username, passwordHash: await hashPassword(password) };
  // La lista que hiciste antes de que hubiera login (usuario sin contraseña)
  // se la queda la primera cuenta que se registre.
  const legacy = await prisma.user.findFirst({ where: { passwordHash: "" }, orderBy: { id: "asc" } });

  try {
    return legacy
      ? await prisma.user.update({ where: { id: legacy.id }, data, select: publicUser })
      : await prisma.user.create({ data, select: publicUser });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      throw new HttpError(409, "Ese correo o usuario ya está en uso");
    }
    throw e;
  }
}

export async function login({ login, password }: LoginInput) {
  const user = await prisma.user.findFirst({ where: { OR: [{ email: login }, { username: login }] } });
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    throw new HttpError(401, "Correo/usuario o contraseña incorrectos");
  }
  return { id: user.id, email: user.email, username: user.username, createdAt: user.createdAt };
}

export async function createSession(userId: number) {
  const id = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await prisma.session.create({ data: { id, userId, expiresAt } });
  return id;
}

/** Devuelve el usuario de la sesión, o null si no existe o caducó */
export async function getSessionUser(sessionId: string) {
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    include: { user: { select: publicUser } },
  });
  if (!session) return null;
  if (session.expiresAt < new Date()) {
    await prisma.session.delete({ where: { id: sessionId } }).catch(() => {});
    return null;
  }
  return session.user;
}

export async function deleteSession(sessionId: string) {
  await prisma.session.deleteMany({ where: { id: sessionId } });
}
