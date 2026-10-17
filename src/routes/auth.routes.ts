import { Router } from "express";
import { loginSchema, registerSchema } from "../schemas/auth.schema.js";
import * as auth from "../services/auth.service.js";
import { HttpError } from "../lib/httpError.js";
import { clearSessionCookie, readSessionCookie, setSessionCookie } from "../middleware/currentUser.js";

export const authRouter = Router();

// POST /api/auth/register  { email, username, password }
authRouter.post("/register", async (req, res) => {
  const user = await auth.register(registerSchema.parse(req.body));
  setSessionCookie(res, await auth.createSession(user.id));
  res.status(201).json(user);
});

// POST /api/auth/login  { login (correo o usuario), password }
authRouter.post("/login", async (req, res) => {
  const user = await auth.login(loginSchema.parse(req.body));
  setSessionCookie(res, await auth.createSession(user.id));
  res.json(user);
});

authRouter.post("/logout", async (req, res) => {
  const sessionId = readSessionCookie(req);
  if (sessionId) await auth.deleteSession(sessionId);
  clearSessionCookie(res);
  res.status(204).end();
});

// GET /api/auth/me  → el usuario con sesión, o 401
authRouter.get("/me", async (req, res) => {
  const sessionId = readSessionCookie(req);
  const user = sessionId ? await auth.getSessionUser(sessionId) : null;
  if (!user) {
    if (sessionId) clearSessionCookie(res);
    throw new HttpError(401, "No has iniciado sesión");
  }
  res.json(user);
});
