import { NextFunction, Response } from "express";
import jwt, { JwtPayload } from "jsonwebtoken";
import { AuthRequest, Role } from "../types";

const validRoles: Role[] = ["customer", "vendor", "admin"];

export function verifyToken(
  req: AuthRequest,
  res: Response,
  next: NextFunction
) {
  const header = req.headers.authorization;

  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Unauthorized: token missing" });
  }

  const token = header.split(" ")[1];
  const secret = process.env.JWT_SECRET;

  if (!secret) {
    return res.status(500).json({ message: "Server misconfigured" });
  }

  try {
    const decoded = jwt.verify(token, secret) as JwtPayload;

    if (
      !decoded.id ||
      !decoded.email ||
      !validRoles.includes(decoded.role as Role)
    ) {
      return res.status(401).json({ message: "Unauthorized: invalid token" });
    }

    req.user = {
      id: decoded.id as string,
      email: decoded.email as string,
      role: decoded.role as Role,
    };

    next();
  } catch {
    return res
      .status(401)
      .json({ message: "Unauthorized: invalid or expired token" });
  }
}

export function requireRole(...roles: Role[]) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    if (!roles.includes(req.user.role)) {
      return res
        .status(403)
        .json({ message: "Forbidden: you do not have access" });
    }

    next();
  };
}