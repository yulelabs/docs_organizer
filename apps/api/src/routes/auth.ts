import { Router } from "express";
import { z } from "zod";
import { config, type OAuthProvider } from "../config.js";
import {
  createSession,
  createUserWithPassword,
  deleteSessionByToken,
  findUserByEmail,
  verifyPassword,
} from "../db/users.js";
import {
  attachUser,
  clearSessionCookie,
  requireAuth,
  setSessionCookie,
  type AuthedRequest,
} from "../middleware/auth.js";
import {
  beginOAuth,
  finishOAuth,
  getOAuthProviderReport,
} from "../services/oauth.js";

export const authRouter = Router();

authRouter.use(attachUser);

authRouter.get("/providers", (_req, res) => {
  const report = getOAuthProviderReport();
  res.json({
    password: true,
    oauth: report.oauth,
    warnings: report.warnings,
  });
});

authRouter.get("/me", (req: AuthedRequest, res) => {
  if (!req.user) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  res.json({ user: req.user });
});

authRouter.post("/register", async (req, res, next) => {
  try {
    const body = z
      .object({
        email: z.string().email().max(320),
        password: z.string().min(8).max(200),
        name: z.string().min(1).max(120).optional(),
      })
      .parse(req.body);

    const existing = await findUserByEmail(body.email);
    if (existing) {
      res.status(409).json({ error: "An account with this email already exists" });
      return;
    }

    const user = await createUserWithPassword({
      email: body.email,
      password: body.password,
      name: body.name,
    });
    const session = await createSession(user.id, config.sessionDays);
    setSessionCookie(res, session.token, session.expiresAt);
    res.status(201).json({
      user,
      token: session.token,
      expiresAt: session.expiresAt.toISOString(),
    });
  } catch (err) {
    next(err);
  }
});

authRouter.post("/login", async (req, res, next) => {
  try {
    const body = z
      .object({
        email: z.string().email().max(320),
        password: z.string().min(1).max(200),
      })
      .parse(req.body);

    const existing = await findUserByEmail(body.email);
    if (!existing?.passwordHash) {
      res.status(401).json({ error: "Invalid email or password" });
      return;
    }

    const ok = await verifyPassword(body.password, existing.passwordHash);
    if (!ok) {
      res.status(401).json({ error: "Invalid email or password" });
      return;
    }

    const session = await createSession(existing.id, config.sessionDays);
    setSessionCookie(res, session.token, session.expiresAt);
    const { passwordHash: _passwordHash, ...user } = existing;
    res.json({
      user,
      token: session.token,
      expiresAt: session.expiresAt.toISOString(),
    });
  } catch (err) {
    next(err);
  }
});

authRouter.post("/logout", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    if (req.sessionToken) {
      await deleteSessionByToken(req.sessionToken);
    }
    clearSessionCookie(res);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

authRouter.get("/oauth/:provider", async (req, res, next) => {
  try {
    const provider = z.enum(["google", "facebook", "github"]).parse(req.params.provider);
    const redirectTo =
      typeof req.query.redirect === "string" ? req.query.redirect : undefined;
    const url = await beginOAuth(provider as OAuthProvider, redirectTo);
    res.redirect(url);
  } catch (err) {
    next(err);
  }
});

authRouter.get("/oauth/:provider/callback", async (req, res, next) => {
  try {
    const provider = z.enum(["google", "facebook", "github"]).parse(req.params.provider);
    const code = typeof req.query.code === "string" ? req.query.code : "";
    const state = typeof req.query.state === "string" ? req.query.state : "";
    const oauthError =
      typeof req.query.error === "string" ? req.query.error : null;

    if (oauthError || !code || !state) {
      const target = new URL(config.publicAppUrl);
      target.searchParams.set("authError", oauthError || "oauth_failed");
      res.redirect(target.toString());
      return;
    }

    const { user, redirectTo } = await finishOAuth({
      provider: provider as OAuthProvider,
      code,
      state,
    });
    const session = await createSession(user.id, config.sessionDays);
    setSessionCookie(res, session.token, session.expiresAt);

    const target = new URL(redirectTo, config.publicAppUrl);
    target.searchParams.set("authToken", session.token);
    res.redirect(target.toString());
  } catch (err) {
    const message = err instanceof Error ? err.message : "oauth_failed";
    const target = new URL(config.publicAppUrl);
    target.searchParams.set("authError", message);
    res.redirect(target.toString());
  }
});
