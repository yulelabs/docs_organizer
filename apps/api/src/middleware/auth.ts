import type { NextFunction, Request, Response } from "express";
import { isSuperUser, type UserRecord } from "@docs-organizer/shared";
import { findUserBySessionToken } from "../db/users.js";
import { config } from "../config.js";

export type AuthedRequest = Request & {
  user?: UserRecord;
  sessionToken?: string;
};

function readBearer(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return null;
  return header.slice("Bearer ".length).trim() || null;
}

function readCookieToken(req: Request): string | null {
  const cookies = (req as Request & { cookies?: Record<string, string> }).cookies;
  const value = cookies?.[config.cookieName];
  return value || null;
}

function readQueryToken(req: Request): string | null {
  const value = req.query.access_token;
  if (typeof value === "string" && value.trim()) return value.trim();
  return null;
}

export async function attachUser(
  req: AuthedRequest,
  _res: Response,
  next: NextFunction,
) {
  try {
    const token = readBearer(req) ?? readCookieToken(req) ?? readQueryToken(req);
    if (!token) {
      next();
      return;
    }
    const user = await findUserBySessionToken(token);
    if (user) {
      req.user = user;
      req.sessionToken = token;
    }
    next();
  } catch (err) {
    next(err);
  }
}

export function requireAuth(
  req: AuthedRequest,
  res: Response,
  next: NextFunction,
) {
  if (!req.user) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  next();
}

export function requireSuperUser(
  req: AuthedRequest,
  res: Response,
  next: NextFunction,
) {
  if (!req.user) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  if (!isSuperUser(req.user)) {
    res.status(403).json({ error: "Super User role required" });
    return;
  }
  next();
}

export function setSessionCookie(res: Response, token: string, expiresAt: Date) {
  res.cookie(config.cookieName, token, {
    httpOnly: true,
    secure: !config.isDev,
    sameSite: config.isDev ? "lax" : "none",
    expires: expiresAt,
    path: "/",
  });
}

export function clearSessionCookie(res: Response) {
  res.clearCookie(config.cookieName, {
    httpOnly: true,
    secure: !config.isDev,
    sameSite: config.isDev ? "lax" : "none",
    path: "/",
  });
}
