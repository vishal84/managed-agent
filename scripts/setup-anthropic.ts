import "dotenv/config";
import { readFileSync, writeFileSync } from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import { buildAgentDefinition } from "../frontend/src/lib/agent-definition";

// Creates (or updates) the Managed Agents environment + agent and prints the ids for .env.
// Pass --write to update .env in place.

// Mirrored in environment.yaml; keep both in sync.
const ENVIRONMENT_NAME = "managed-agent-env";
// The agent reaches MCP_PUBLIC_URL over the public internet. Under `limited` networking that host
// must be in allowed_hosts (or allow_mcp_servers must be true), or sessions.create() fails with a
// 400 before the agent ever runs.
const ENVIRONMENT_CONFIG = { type: "cloud" as const, networking: { type: "unrestricted" as const } };

async function main() {
  const mcpPublicUrl = process.env.MCP_PUBLIC_URL;
  if (!mcpPublicUrl?.startsWith("https://")) {
    throw new Error("MCP_PUBLIC_URL must be set to the public https URL of this app's /api/mcp route (e.g. https://vacay.example.com/api/mcp).");
  }

  const client = new Anthropic();
  const updates: Record<string, string> = {};

  let environmentId = process.env.ANTHROPIC_ENVIRONMENT_ID;
  if (environmentId) {
    // Re-apply the config rather than trusting it: an environment edited in the Console can drift
    // into a network policy that blocks the MCP host. Updates affect new containers only —
    // sessions already running keep the config they started with.
    const environment = await client.beta.environments.update(environmentId, { config: ENVIRONMENT_CONFIG });
    console.log(`Updated environment ${environment.id} (${environment.name}) → networking: ${ENVIRONMENT_CONFIG.networking.type}`);
  } else {
    const environment = await client.beta.environments.create({ name: ENVIRONMENT_NAME, config: ENVIRONMENT_CONFIG });
    environmentId = environment.id;
    updates.ANTHROPIC_ENVIRONMENT_ID = environmentId;
    console.log(`Created environment ${environment.id} (${environment.name}) → networking: ${ENVIRONMENT_CONFIG.networking.type}`);
  }

  const definition = buildAgentDefinition(mcpPublicUrl);
  let agentId = process.env.VACATION_AGENT_ID;
  if (agentId) {
    const agent = await client.beta.agents.update(agentId, definition);
    console.log(`Updated agent ${agent.id} → version ${agent.version} (MCP server: ${mcpPublicUrl})`);
  } else {
    const agent = await client.beta.agents.create(definition);
    agentId = agent.id;
    updates.VACATION_AGENT_ID = agentId;
    console.log(`Created agent ${agent.id} v${agent.version} (MCP server: ${mcpPublicUrl})`);
  }

  if (Object.keys(updates).length > 0) {
    console.log("\nAdd these to .env:");
    for (const [key, value] of Object.entries(updates)) console.log(`${key}=${value}`);
    if (process.argv.includes("--write")) {
      writeEnv(updates);
      console.log("\nWrote them to .env.");
    }
  } else {
    console.log("\nNo .env changes needed.");
  }

  console.log("\nNext: register a webhook in the Claude Console for session.status_idled + session.status_terminated");
  console.log(`pointing at ${new URL("/api/webhooks/anthropic", mcpPublicUrl).href} and put its signing key in ANTHROPIC_WEBHOOK_SIGNING_KEY.`);
}

function writeEnv(updates: Record<string, string>) {
  let contents = "";
  try {
    contents = readFileSync(".env", "utf8");
  } catch {
    contents = "";
  }
  for (const [key, value] of Object.entries(updates)) {
    const line = `${key}=${value}`;
    const pattern = new RegExp(`^${key}=.*$`, "m");
    contents = pattern.test(contents) ? contents.replace(pattern, line) : `${contents.replace(/\n?$/, "\n")}${line}\n`;
  }
  writeFileSync(".env", contents);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
