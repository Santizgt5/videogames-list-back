import { z } from "zod";

const password = z
  .string()
  .min(8, "La contraseña debe tener al menos 8 caracteres")
  .max(200, "Contraseña demasiado larga");

export const registerSchema = z.object({
  email: z.email("Correo inválido").trim().toLowerCase(),
  username: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9_]{3,20}$/, "El usuario debe tener 3-20 letras, números o _"),
  password,
});

export const loginSchema = z.object({
  /** Correo o nombre de usuario */
  login: z.string().trim().toLowerCase().min(1, "Escribe tu correo o usuario"),
  password: z.string().min(1, "Escribe tu contraseña"),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
