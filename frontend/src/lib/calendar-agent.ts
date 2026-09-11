import type Anthropic from "@anthropic-ai/sdk";
import type { VacationRequest } from "@/generated/prisma/client";
import { anthropic, sessionTraceUrl } from "@/lib/anthropic";
import { formatRange } from "@/lib/dates";
import { env } from "@/lib/env";
import { getFreshGoogleAccessToken } from "@/lib/google-token";
import { prisma } from "@/lib/prisma";
import { MAX_CALENDAR_JOB_ATTEMPTS, REASON_LABELS } from "@/lib/requests";
import { ensureVaultCredential } from "@/lib/vault";

const STALE_RUNNING_MS = 3 * 60_000;
const TIMEOUT_MS = 10 * 60_000;

type SessionEvent = Anthropic.Beta.Sessions.BetaManagedAgentsSessionEvent;

export function buildTaskMessage(request: VacationRequest & { user: { email: string | null } }): string {
  const start = request.startDate.toISOString().slice(0, 10);
  const end = request.endDate.toISOString().slice(0, 10);
  return [
    `Create an out-of-office block on the calendar of ${request.user.email}.`,
    "",
    `request_id: ${request.id}`,
    `employee_email: ${request.user.email}`,
    `start_date: ${start} (inclusive)`,
    `end_date: ${end} (inclusive)`,
    `time_zone: ${request.timeZone}`,
    `reason: ${REASON_LABELS[request.reason]}`,
    `comments: ${request.comments?.trim() || "—"}`,
    "",
    "Call list_events for that date range first. If an out-of-office block for this request already exists, report its event id and stop.",
    "Otherwise call create_out_of_office exactly once with request_id, start_date, and end_date passed verbatim.",
    'Then reply with only "EVENT_ID: <event id>" on the final line.',
  ].join("\n");
}

export async function startCalendarJob(requestId: string): Promise<void> {
  const request = await prisma.vacationRequest.findUnique({ where: { id: requestId }, include: { user: true } });
  if (!request || request.status !== "APPROVED") return;
  if (request.calendarJobStatus === "RUNNING" || request.calendarJobStatus === "SUCCEEDED") return;
  if (request.calendarJobAttempts >= MAX_CALENDAR_JOB_ATTEMPTS) {
    await markFailed(requestId, `Gave up after ${MAX_CALENDAR_JOB_ATTEMPTS} attempts.`);
    return;
  }

  await prisma.vacationRequest.update({
    where: { id: requestId },
    data: {
      calendarJobStatus: "RUNNING",
      calendarJobStartedAt: new Date(),
      calendarJobFinishedAt: null,
      calendarJobError: null,
      agentSessionId: null,
      calendarJobAttempts: { increment: 1 },
    },
  });

  try {
    const token = await getFreshGoogleAccessToken(request.userId);
    const vaultId = await ensureVaultCredential(request.user, token);
    const start = request.startDate.toISOString().slice(0, 10);
    const end = request.endDate.toISOString().slice(0, 10);

    const session = await anthropic.beta.sessions.create({
      agent: env.vacationAgentId(),
      environment_id: env.anthropicEnvironmentId(),
      vault_ids: [vaultId],
      title: `OOO ${request.user.email} ${formatRange(start, end)}`,
      metadata: { vacationRequestId: request.id },
      initial_events: [{ type: "user.message", content: [{ type: "text", text: buildTaskMessage(request) }] }],
    });

    await prisma.vacationRequest.update({ where: { id: requestId }, data: { agentSessionId: session.id } });
    console.log(`[calendar-agent] request ${requestId} → session ${session.id} ${sessionTraceUrl(session.id)}`);
  } catch (error) {
    console.error(`[calendar-agent] request ${requestId} failed to start`, error);
    await markFailed(requestId, errorMessage(error));
  }
}

export async function reconcileJob(requestId: string): Promise<VacationRequest | null> {
  const request = await prisma.vacationRequest.findUnique({ where: { id: requestId } });
  if (!request || request.calendarJobStatus !== "RUNNING") return request;
  if (!request.agentSessionId) {
    if (isOlderThan(request.calendarJobStartedAt, STALE_RUNNING_MS)) {
      return markFailed(requestId, "The calendar job never started an agent session.");
    }
    return request;
  }

  const session = await anthropic.beta.sessions.retrieve(request.agentSessionId);
  const outcome = await summarizeSession(request.agentSessionId);

  // The MCP route records the event id itself, so re-read before deciding.
  const fresh = await prisma.vacationRequest.findUnique({ where: { id: requestId } });
  if (!fresh) return null;
  if (fresh.calendarEventId) {
    return prisma.vacationRequest.update({
      where: { id: requestId },
      data: { calendarJobStatus: "SUCCEEDED", calendarJobError: null, calendarJobFinishedAt: fresh.calendarJobFinishedAt ?? new Date() },
    });
  }

  if (session.status === "running" || session.status === "rescheduling") {
    if (isOlderThan(fresh.calendarJobStartedAt, TIMEOUT_MS)) {
      return markFailed(requestId, "Timed out waiting for the agent to finish.");
    }
    return fresh;
  }

  if (outcome.error) return markFailed(requestId, outcome.error);
  if (session.status === "idle" && outcome.pendingToolUses > 0) {
    return markFailed(
      requestId,
      "The agent is waiting for tool permission. Set permission_policy to always_allow on the agent's MCP toolset and re-run the setup script.",
    );
  }
  return markFailed(requestId, outcome.lastAgentText || "The agent finished without creating a calendar event.");
}

export async function reconcileStaleJobs(): Promise<number> {
  const stale = await prisma.vacationRequest.findMany({
    where: { calendarJobStatus: "RUNNING", calendarJobStartedAt: { lt: new Date(Date.now() - STALE_RUNNING_MS) } },
    select: { id: true },
  });
  for (const { id } of stale) {
    await reconcileJob(id).catch((error) => console.error(`[calendar-agent] reconcile ${id} failed`, error));
  }
  return stale.length;
}

async function summarizeSession(sessionId: string) {
  const pending = new Set<string>();
  let error: string | null = null;
  let lastAgentText = "";

  for await (const event of anthropic.beta.sessions.events.list(sessionId, { order: "asc" })) {
    const e = event as SessionEvent;
    switch (e.type) {
      case "agent.mcp_tool_use":
        pending.add(e.id);
        break;
      case "agent.mcp_tool_result":
        pending.delete(e.mcp_tool_use_id);
        if (e.is_error) error = textOf(e.content) || "MCP tool call failed.";
        break;
      case "agent.message":
        lastAgentText = textOf(e.content);
        break;
      case "session.error":
        error = `${e.error.type}: ${describeError(e.error)}`;
        break;
    }
  }

  return { error, lastAgentText, pendingToolUses: pending.size };
}

function textOf(content: Array<{ type: string; text?: string }> | undefined): string {
  return (content ?? [])
    .filter((block): block is { type: "text"; text: string } => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

function describeError(error: unknown): string {
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") return error.message;
  return JSON.stringify(error);
}

function isOlderThan(date: Date | null, ms: number): boolean {
  return !!date && Date.now() - date.getTime() > ms;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function markFailed(requestId: string, message: string) {
  return prisma.vacationRequest.update({
    where: { id: requestId },
    data: { calendarJobStatus: "FAILED", calendarJobError: message.slice(0, 2000), calendarJobFinishedAt: new Date() },
  });
}
