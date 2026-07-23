import { createHash, randomBytes } from "node:crypto";
import { config, inspectOAuthConfig, oauthEnabled, type OAuthProvider } from "../config.js";
import {
  consumeOAuthState,
  findOrCreateOAuthUser,
  generateToken,
  saveOAuthState,
  type UserRecord,
} from "../db/users.js";

function base64Url(buffer: Buffer): string {
  return buffer.toString("base64url");
}

function pkceChallenge(verifier: string): string {
  return base64Url(createHash("sha256").update(verifier).digest());
}

function callbackUrl(provider: OAuthProvider): string {
  return `${config.publicApiUrl.replace(/\/$/, "")}/api/auth/oauth/${provider}/callback`;
}

/** Only allow redirects back to the public app origin (or relative paths). */
export function sanitizeRedirectTo(redirectTo?: string | null): string {
  const fallback = config.publicAppUrl;
  if (!redirectTo) return fallback;
  try {
    const target = new URL(redirectTo, fallback);
    const allowed = new URL(fallback);
    if (target.origin !== allowed.origin) return fallback;
    return target.toString();
  } catch {
    return fallback;
  }
}

export function listEnabledOAuthProviders(): OAuthProvider[] {
  return inspectOAuthConfig().enabled;
}

export function getOAuthProviderReport(): {
  oauth: OAuthProvider[];
  warnings: string[];
} {
  const { enabled, warnings } = inspectOAuthConfig();
  return { oauth: enabled, warnings };
}

export async function beginOAuth(
  provider: OAuthProvider,
  redirectTo?: string | null,
): Promise<string> {
  if (!oauthEnabled(provider)) {
    throw new Error(`${provider} sign-in is not configured`);
  }

  const state = generateToken(24);
  let codeVerifier: string | null = null;
  const params = new URLSearchParams({ state });

  if (provider === "google") {
    codeVerifier = base64Url(randomBytes(32));
    params.set("client_id", config.oauth.google.clientId);
    params.set("redirect_uri", callbackUrl("google"));
    params.set("response_type", "code");
    params.set("scope", "openid email profile");
    params.set("access_type", "online");
    params.set("prompt", "select_account");
    params.set("code_challenge", pkceChallenge(codeVerifier));
    params.set("code_challenge_method", "S256");
  } else if (provider === "facebook") {
    params.set("client_id", config.oauth.facebook.clientId);
    params.set("redirect_uri", callbackUrl("facebook"));
    params.set("response_type", "code");
    params.set("scope", "email,public_profile");
  } else {
    params.set("client_id", config.oauth.github.clientId);
    params.set("redirect_uri", callbackUrl("github"));
    params.set("scope", "read:user user:email");
    params.set("allow_signup", "true");
  }

  await saveOAuthState({
    state,
    provider,
    codeVerifier,
    redirectTo: sanitizeRedirectTo(redirectTo),
  });

  const authorizeUrl =
    provider === "google"
      ? `https://accounts.google.com/o/oauth2/v2/auth?${params}`
      : provider === "facebook"
        ? `https://www.facebook.com/v19.0/dialog/oauth?${params}`
        : `https://github.com/login/oauth/authorize?${params}`;

  return authorizeUrl;
}

async function exchangeGoogle(code: string, codeVerifier: string | null) {
  const body = new URLSearchParams({
    code,
    client_id: config.oauth.google.clientId,
    client_secret: config.oauth.google.clientSecret,
    redirect_uri: callbackUrl("google"),
    grant_type: "authorization_code",
  });
  if (codeVerifier) body.set("code_verifier", codeVerifier);

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!tokenRes.ok) {
    throw new Error(`Google token exchange failed (${tokenRes.status})`);
  }
  const tokenJson = (await tokenRes.json()) as { access_token?: string };
  if (!tokenJson.access_token) throw new Error("Google access token missing");

  const profileRes = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${tokenJson.access_token}` },
  });
  if (!profileRes.ok) {
    throw new Error(`Google profile fetch failed (${profileRes.status})`);
  }
  const profile = (await profileRes.json()) as {
    sub: string;
    email?: string;
    email_verified?: boolean;
    name?: string;
    picture?: string;
  };
  if (!profile.email) throw new Error("Google account has no email");
  return {
    providerUserId: profile.sub,
    email: profile.email,
    name: profile.name ?? null,
    avatarUrl: profile.picture ?? null,
    emailVerified: Boolean(profile.email_verified),
  };
}

async function exchangeFacebook(code: string) {
  const tokenUrl = new URL("https://graph.facebook.com/v19.0/oauth/access_token");
  tokenUrl.searchParams.set("client_id", config.oauth.facebook.clientId);
  tokenUrl.searchParams.set("client_secret", config.oauth.facebook.clientSecret);
  tokenUrl.searchParams.set("redirect_uri", callbackUrl("facebook"));
  tokenUrl.searchParams.set("code", code);

  const tokenRes = await fetch(tokenUrl);
  if (!tokenRes.ok) {
    throw new Error(`Facebook token exchange failed (${tokenRes.status})`);
  }
  const tokenJson = (await tokenRes.json()) as { access_token?: string };
  if (!tokenJson.access_token) throw new Error("Facebook access token missing");

  const profileUrl = new URL("https://graph.facebook.com/me");
  profileUrl.searchParams.set("fields", "id,name,email,picture.type(large)");
  profileUrl.searchParams.set("access_token", tokenJson.access_token);
  const profileRes = await fetch(profileUrl);
  if (!profileRes.ok) {
    throw new Error(`Facebook profile fetch failed (${profileRes.status})`);
  }
  const profile = (await profileRes.json()) as {
    id: string;
    name?: string;
    email?: string;
    picture?: { data?: { url?: string } };
  };
  if (!profile.email) {
    throw new Error("Facebook account did not return an email. Grant email permission.");
  }
  return {
    providerUserId: profile.id,
    email: profile.email,
    name: profile.name ?? null,
    avatarUrl: profile.picture?.data?.url ?? null,
    emailVerified: true,
  };
}

async function exchangeGithub(code: string) {
  const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      client_id: config.oauth.github.clientId,
      client_secret: config.oauth.github.clientSecret,
      code,
      redirect_uri: callbackUrl("github"),
    }),
  });
  if (!tokenRes.ok) {
    throw new Error(`GitHub token exchange failed (${tokenRes.status})`);
  }
  const tokenJson = (await tokenRes.json()) as { access_token?: string };
  if (!tokenJson.access_token) throw new Error("GitHub access token missing");

  const profileRes = await fetch("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${tokenJson.access_token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "docs-organizer",
    },
  });
  if (!profileRes.ok) {
    throw new Error(`GitHub profile fetch failed (${profileRes.status})`);
  }
  const profile = (await profileRes.json()) as {
    id: number;
    login: string;
    name?: string | null;
    email?: string | null;
    avatar_url?: string;
  };

  let email = profile.email ?? null;
  if (!email) {
    const emailsRes = await fetch("https://api.github.com/user/emails", {
      headers: {
        Authorization: `Bearer ${tokenJson.access_token}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "docs-organizer",
      },
    });
    if (emailsRes.ok) {
      const emails = (await emailsRes.json()) as Array<{
        email: string;
        primary?: boolean;
        verified?: boolean;
      }>;
      email =
        emails.find((e) => e.primary && e.verified)?.email ??
        emails.find((e) => e.verified)?.email ??
        emails[0]?.email ??
        null;
    }
  }
  if (!email) {
    throw new Error("GitHub account has no accessible email");
  }

  return {
    providerUserId: String(profile.id),
    email,
    name: profile.name || profile.login,
    avatarUrl: profile.avatar_url ?? null,
    emailVerified: true,
  };
}

export async function finishOAuth(input: {
  provider: OAuthProvider;
  code: string;
  state: string;
}): Promise<{ user: UserRecord; redirectTo: string }> {
  const saved = await consumeOAuthState(input.state);
  if (!saved || saved.provider !== input.provider) {
    throw new Error("Invalid or expired OAuth state");
  }

  const profile =
    input.provider === "google"
      ? await exchangeGoogle(input.code, saved.codeVerifier)
      : input.provider === "facebook"
        ? await exchangeFacebook(input.code)
        : await exchangeGithub(input.code);

  const user = await findOrCreateOAuthUser({
    provider: input.provider,
    ...profile,
  });

  return {
    user,
    redirectTo: sanitizeRedirectTo(saved.redirectTo),
  };
}
