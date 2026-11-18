import { Request } from "express";

export type Role = "customer" | "vendor" | "admin";

export interface AuthUser {
  id: string;
  email: string;
  role: Role;
}

export interface AuthRequest extends Request {
  user?: AuthUser;
}