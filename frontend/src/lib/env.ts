function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

export const env = {
  googleClientId: () => required("GOOGLE_CLIENT_ID"),
  googleClientSecret: () => required("GOOGLE_CLIENT_SECRET"),
  mcpPublicUrl: () => required("MCP_PUBLIC_URL"),
  anthropicEnvironmentId: () => required("ANTHROPIC_ENVIRONMENT_ID"),
  vacationAgentId: () => required("VACATION_AGENT_ID"),
  anthropicWorkspaceId: () => process.env.ANTHROPIC_WORKSPACE_ID || "default",
  webhookSigningKey: () => process.env.ANTHROPIC_WEBHOOK_SIGNING_KEY || null,
  managerEmails: () =>
    (process.env.MANAGER_EMAILS ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
};

export const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
export const GOOGLE_CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.events";
