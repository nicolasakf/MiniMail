import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

import { z } from "zod";

import type { Account } from "@shared/types";

/** Client ids baked in at build time from `.env.local` (see `.env.example`). */
export interface OAuthConfig {
  googleClientId?: string;
  googleClientSecret?: string;
  microsoftClientId?: string;
}

export interface OAuthTokens {
  accessToken: string;
  refreshToken: string;
  /** Epoch milliseconds. */
  expiresAt: number;
}

export interface OAuthIdentity {
  email: string;
  name: string;
  tokens: OAuthTokens;
}

/** Thrown when a provider's client id is missing, so the UI can explain how to set it up. */
export class OAuthNotConfiguredError extends Error {
  constructor(provider: "Google" | "Microsoft") {
    super(
      `${provider} sign-in is not configured in this build. Add the client id to .env.local (see README) and rebuild.`,
    );
    this.name = "OAuthNotConfiguredError";
  }
}

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";
/** Full IMAP/SMTP access; Gmail exposes no narrower scope for IMAP. */
const GOOGLE_SCOPES = "https://mail.google.com/ openid email profile";

const MICROSOFT_SCOPES = [
  "openid",
  "profile",
  "email",
  "offline_access",
  "https://graph.microsoft.com/Mail.ReadWrite",
  "https://graph.microsoft.com/Mail.Send",
  "https://graph.microsoft.com/User.Read",
].join(" ");

const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;

const tokenResponseSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string().optional(),
  expires_in: z.number(),
});

const googleUserSchema = z.object({
  email: z.string(),
  name: z.string().optional(),
});

const graphMeSchema = z.object({
  mail: z.string().nullable().optional(),
  userPrincipalName: z.string().optional(),
  displayName: z.string().nullable().optional(),
});

/** Which Microsoft login authority an account signs in against. */
export function microsoftAuthority(account: Pick<Account, "outlookKind" | "tenant">): string {
  if (account.outlookKind === "personal") return "consumers";
  return account.tenant?.trim() || "organizations";
}

export function oauthCapabilities(config: OAuthConfig): {
  googleOAuth: boolean;
  microsoftOAuth: boolean;
} {
  return {
    googleOAuth: Boolean(config.googleClientId && config.googleClientSecret),
    microsoftOAuth: Boolean(config.microsoftClientId),
  };
}

/** PKCE verifier/challenge pair (RFC 7636, S256). */
function createPkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

const SUCCESS_PAGE = `<!doctype html><meta charset="utf-8"><title>MiniMail</title>
<body style="font-family:system-ui;background:#0a0a0a;color:#fafafa;display:grid;place-items:center;height:100vh;margin:0">
<div style="text-align:center"><h2>Signed in</h2><p style="color:#a3a3a3">You can close this tab and return to MiniMail.</p></div></body>`;

interface AuthorizationResult {
  code: string;
  redirectUri: string;
  verifier: string;
}

/**
 * Runs the browser half of an authorization-code + PKCE flow: starts a one-shot
 * loopback server, opens the system browser, and resolves with the returned code.
 * `redirectHost` matters: Google accepts 127.0.0.1, Microsoft's registration uses localhost.
 */
async function authorize(options: {
  redirectHost: "127.0.0.1" | "localhost";
  buildAuthUrl: (args: { redirectUri: string; state: string; challenge: string }) => string;
  openExternal: (url: string) => Promise<void>;
}): Promise<AuthorizationResult> {
  const { verifier, challenge } = createPkce();
  const state = randomBytes(16).toString("hex");

  return new Promise<AuthorizationResult>((resolve, reject) => {
    // Captured when the server starts listening; `server.address()` is null once it is closed.
    let redirectUri = "";

    const server = createServer((request, response) => {
      const url = new URL(request.url ?? "/", "http://loopback");
      const error = url.searchParams.get("error");
      const code = url.searchParams.get("code");

      if (url.pathname !== "/" || (!error && !code)) {
        response.writeHead(404).end();
        return;
      }

      response.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(SUCCESS_PAGE);
      clearTimeout(timer);
      server.close();

      if (error) {
        reject(new Error(url.searchParams.get("error_description") ?? error));
      } else if (url.searchParams.get("state") !== state || !code) {
        reject(new Error("Sign-in was rejected: the response did not match the request."));
      } else {
        resolve({ code, verifier, redirectUri });
      }
    });

    const timer = setTimeout(() => {
      server.close();
      reject(new Error("Sign-in timed out. Please try again."));
    }, LOGIN_TIMEOUT_MS);

    server.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });

    server.listen(0, options.redirectHost, () => {
      const { port } = server.address() as AddressInfo;
      redirectUri = `http://${options.redirectHost}:${port}`;
      options
        .openExternal(options.buildAuthUrl({ redirectUri, state, challenge }))
        .catch((error: unknown) => {
          clearTimeout(timer);
          server.close();
          reject(error);
        });
    });
  });
}

/** POSTs a form to a token endpoint and validates the response. */
async function requestTokens(
  url: string,
  form: Record<string, string>,
  previousRefreshToken?: string,
): Promise<OAuthTokens> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form),
  });
  const body: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    const failure = z
      .object({ error: z.string().optional(), error_description: z.string().optional() })
      .safeParse(body);
    const detail = failure.success
      ? (failure.data.error_description ?? failure.data.error)
      : undefined;
    throw new Error(detail ?? `Token request failed (${response.status}).`);
  }
  const tokens = tokenResponseSchema.parse(body);
  const refreshToken = tokens.refresh_token ?? previousRefreshToken;
  if (!refreshToken) {
    throw new Error("The provider did not return a refresh token, so the session cannot be kept.");
  }
  return {
    accessToken: tokens.access_token,
    refreshToken,
    expiresAt: Date.now() + tokens.expires_in * 1000,
  };
}

/** Interactive Google sign-in. Returns the identity plus tokens usable for IMAP/SMTP XOAUTH2. */
export async function signInWithGoogle(
  config: OAuthConfig,
  openExternal: (url: string) => Promise<void>,
  loginHint?: string,
): Promise<OAuthIdentity> {
  const { googleClientId, googleClientSecret } = config;
  if (!googleClientId || !googleClientSecret) throw new OAuthNotConfiguredError("Google");

  const { code, redirectUri, verifier } = await authorize({
    redirectHost: "127.0.0.1",
    openExternal,
    buildAuthUrl: ({ redirectUri: redirect, state, challenge }) => {
      const url = new URL(GOOGLE_AUTH_URL);
      url.search = new URLSearchParams({
        client_id: googleClientId,
        redirect_uri: redirect,
        response_type: "code",
        scope: GOOGLE_SCOPES,
        state,
        code_challenge: challenge,
        code_challenge_method: "S256",
        access_type: "offline",
        // Forces a refresh token even if the user consented before.
        prompt: "consent",
        ...(loginHint ? { login_hint: loginHint } : {}),
      }).toString();
      return url.toString();
    },
  });

  const tokens = await requestTokens(GOOGLE_TOKEN_URL, {
    client_id: googleClientId,
    client_secret: googleClientSecret,
    code,
    code_verifier: verifier,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  });

  const userResponse = await fetch(GOOGLE_USERINFO_URL, {
    headers: { authorization: `Bearer ${tokens.accessToken}` },
  });
  const user = googleUserSchema.parse(await userResponse.json());
  return { email: user.email, name: user.name ?? user.email, tokens };
}

/**
 * Interactive Microsoft sign-in. Personal accounts use the `consumers` authority;
 * a university/work account uses `organizations` (or its own tenant), which sends
 * the user to their institution's login page and may require admin consent.
 */
export async function signInWithMicrosoft(
  config: OAuthConfig,
  openExternal: (url: string) => Promise<void>,
  target: Pick<Account, "outlookKind" | "tenant">,
  loginHint?: string,
): Promise<OAuthIdentity> {
  const clientId = config.microsoftClientId;
  if (!clientId) throw new OAuthNotConfiguredError("Microsoft");

  const authority = microsoftAuthority(target);
  const base = `https://login.microsoftonline.com/${encodeURIComponent(authority)}/oauth2/v2.0`;

  const { code, redirectUri, verifier } = await authorize({
    redirectHost: "localhost",
    openExternal,
    buildAuthUrl: ({ redirectUri: redirect, state, challenge }) => {
      const url = new URL(`${base}/authorize`);
      url.search = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirect,
        response_type: "code",
        response_mode: "query",
        scope: MICROSOFT_SCOPES,
        state,
        code_challenge: challenge,
        code_challenge_method: "S256",
        prompt: "select_account",
        ...(loginHint ? { login_hint: loginHint } : {}),
      }).toString();
      return url.toString();
    },
  });

  const tokens = await requestTokens(`${base}/token`, {
    client_id: clientId,
    code,
    code_verifier: verifier,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
    scope: MICROSOFT_SCOPES,
  });

  const meResponse = await fetch(
    "https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName,displayName",
    { headers: { authorization: `Bearer ${tokens.accessToken}` } },
  );
  if (!meResponse.ok) {
    throw new Error(
      `Microsoft signed you in but would not share the account's profile (HTTP ${meResponse.status}). For a work or school account, ask IT whether this app is allowed.`,
    );
  }
  const me = graphMeSchema.parse(await meResponse.json());
  const email = me.mail || me.userPrincipalName;
  if (!email) throw new Error("Microsoft did not return an email address for this account.");
  return { email, name: me.displayName || email, tokens };
}

/** Exchanges a refresh token for a new access token for the given account. */
export async function refreshAccessToken(
  config: OAuthConfig,
  account: Pick<Account, "provider" | "outlookKind" | "tenant">,
  refreshToken: string,
): Promise<OAuthTokens> {
  if (account.provider === "gmail") {
    if (!config.googleClientId || !config.googleClientSecret) {
      throw new OAuthNotConfiguredError("Google");
    }
    return requestTokens(
      GOOGLE_TOKEN_URL,
      {
        client_id: config.googleClientId,
        client_secret: config.googleClientSecret,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      },
      refreshToken,
    );
  }
  if (account.provider === "outlook") {
    if (!config.microsoftClientId) throw new OAuthNotConfiguredError("Microsoft");
    const authority = microsoftAuthority(account);
    return requestTokens(
      `https://login.microsoftonline.com/${encodeURIComponent(authority)}/oauth2/v2.0/token`,
      {
        client_id: config.microsoftClientId,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
        scope: MICROSOFT_SCOPES,
      },
      refreshToken,
    );
  }
  throw new Error(`${account.provider} does not use OAuth.`);
}
