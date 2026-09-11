import Anthropic from "@anthropic-ai/sdk";
import type { User } from "@/generated/prisma/client";
import { anthropic } from "@/lib/anthropic";
import { env, GOOGLE_TOKEN_ENDPOINT } from "@/lib/env";
import type { GoogleToken } from "@/lib/google-token";
import { prisma } from "@/lib/prisma";

// Returns the vault id whose credential for MCP_PUBLIC_URL carries this user's Google token.
export async function ensureVaultCredential(user: User, token: GoogleToken): Promise<string> {
  const mcpUrl = env.mcpPublicUrl();

  let vaultId = user.anthropicVaultId;
  if (!vaultId) {
    const vault = await anthropic.beta.vaults.create({
      display_name: `Google Calendar – ${user.email ?? user.id}`,
      metadata: { userId: user.id },
    });
    vaultId = vault.id;
  }

  let credentialId = user.vaultCredentialId;
  // mcp_server_url is immutable on a credential, so a moved MCP URL means archive + recreate.
  if (credentialId && user.vaultCredentialUrl !== mcpUrl) {
    await anthropic.beta.vaults.credentials.archive(credentialId, { vault_id: vaultId }).catch(ignoreNotFound);
    credentialId = null;
  }

  if (credentialId) {
    try {
      await anthropic.beta.vaults.credentials.update(credentialId, {
        vault_id: vaultId,
        auth: {
          type: "mcp_oauth",
          access_token: token.accessToken,
          expires_at: token.expiresAt.toISOString(),
          refresh: { refresh_token: token.refreshToken },
        },
      });
    } catch (error) {
      if (!(error instanceof Anthropic.NotFoundError)) throw error;
      credentialId = null;
    }
  }

  if (!credentialId) {
    const credential = await anthropic.beta.vaults.credentials.create(vaultId, {
      display_name: `Google Calendar (${user.email ?? user.id})`,
      auth: {
        type: "mcp_oauth",
        mcp_server_url: mcpUrl,
        access_token: token.accessToken,
        expires_at: token.expiresAt.toISOString(),
        refresh: {
          refresh_token: token.refreshToken,
          client_id: env.googleClientId(),
          token_endpoint: GOOGLE_TOKEN_ENDPOINT,
          token_endpoint_auth: { type: "client_secret_post", client_secret: env.googleClientSecret() },
        },
      },
    });
    credentialId = credential.id;
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { anthropicVaultId: vaultId, vaultCredentialId: credentialId, vaultCredentialUrl: mcpUrl },
  });

  return vaultId;
}

function ignoreNotFound(error: unknown) {
  if (!(error instanceof Anthropic.NotFoundError)) throw error;
}
