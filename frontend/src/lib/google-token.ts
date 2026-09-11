import { prisma } from "@/lib/prisma";
import { env, GOOGLE_TOKEN_ENDPOINT } from "@/lib/env";

export class GoogleAuthError extends Error {}

export interface GoogleToken {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}

const REFRESH_LEEWAY_MS = 60_000;

export async function getFreshGoogleAccessToken(userId: string): Promise<GoogleToken> {
  const account = await prisma.account.findFirst({ where: { userId, provider: "google" } });
  if (!account?.refresh_token) {
    throw new GoogleAuthError("Google account is not connected with offline access. Sign in again to reconnect.");
  }

  const expiresAtMs = (account.expires_at ?? 0) * 1000;
  if (account.access_token && expiresAtMs - Date.now() > REFRESH_LEEWAY_MS) {
    return { accessToken: account.access_token, refreshToken: account.refresh_token, expiresAt: new Date(expiresAtMs) };
  }

  const response = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: account.refresh_token,
      client_id: env.googleClientId(),
      client_secret: env.googleClientSecret(),
    }),
  });
  const body = (await response.json().catch(() => ({}))) as {
    access_token?: string;
    expires_in?: number;
    refresh_token?: string;
    error?: string;
    error_description?: string;
  };

  if (!response.ok || !body.access_token) {
    if (body.error === "invalid_grant") {
      await prisma.account.update({ where: { id: account.id }, data: { refresh_token: null } });
      throw new GoogleAuthError("Google connection expired or was revoked. Ask the employee to sign in again.");
    }
    throw new GoogleAuthError(`Google token refresh failed: ${body.error_description ?? body.error ?? response.status}`);
  }

  const expiresAt = new Date(Date.now() + (body.expires_in ?? 3600) * 1000);
  const refreshToken = body.refresh_token ?? account.refresh_token;
  await prisma.account.update({
    where: { id: account.id },
    data: {
      access_token: body.access_token,
      expires_at: Math.floor(expiresAt.getTime() / 1000),
      refresh_token: refreshToken,
    },
  });

  return { accessToken: body.access_token, refreshToken, expiresAt };
}
