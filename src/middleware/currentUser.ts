import type { CookieOptions, Request, RequestHandler, Response } from "express";
import { HttpError } from "../lib/httpError.js";
import { getSessionUser, SESSION_DAYS } from "../services/auth.service.js";

export const SESSION_COOKIE = "sid";

const cookieOptions: CookieOptions = {
  httpOnly: true, // el JavaScript del navegador no puede leerla
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
  path: "/",
};

export function setSessionCookie(res: Response, sessionId: string) {
  res.cookie(SESSION_COOKIE, sessionId, { ...cookieOptions, maxAge: SESSION_DAYS * 24 * 60 * 60 * 1000 });
}

export function clearSessionCookie(res: Response) {
  res.clearCookie(SESSION_COOKIE, cookieOptions);
}

/** Express 5 no lee cookies por sí solo; solo necesitamos una */
export function readSessionCookie(req: Request) {
  for (const part of req.headers.cookie?.split(";") ?? []) {
    const [name, ...rest] = part.trim().split("=");
    if (name === SESSION_COOKIE) return decodeURIComponent(rest.join("="));
  }
  return null;
}

/** Exige sesión iniciada y pone req.userId. El resto del código ya filtra por él. */
export const requireUser: RequestHandler = async (req, _res, next) => {
  const sessionId = readSessionCookie(req);
  const user = sessionId ? await getSessionUser(sessionId) : null;
  if (!user) throw new HttpError(401, "Inicia sesión para continuar");
  req.userId = user.id;
  next();
};
