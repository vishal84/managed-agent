import type { AuthInfo } from "@modelcontextprotocol/server";
import { createMcpHandler, withMcpAuth } from "mcp-handler";
import { z } from "zod";
import { YMD_PATTERN } from "@/lib/dates";
import { createAllDayBlock, GoogleCalendarError, listEvents } from "@/lib/gcal";
import { prisma } from "@/lib/prisma";
import { REASON_LABELS } from "@/lib/requests";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ymd = z.string().regex(YMD_PATTERN).describe("Calendar date in YYYY-MM-DD format");

function toolError(message: string) {
  return { isError: true, content: [{ type: "text" as const, text: message }] };
}

function toolText(text: string, structuredContent?: Record<string, unknown>) {
  return { content: [{ type: "text" as const, text }], structuredContent };
}

function callerOf(authInfo: AuthInfo | undefined) {
  const extra = authInfo?.extra as { userId?: string; email?: string } | undefined;
  if (!authInfo || !extra?.userId) return null;
  return { token: authInfo.token, userId: extra.userId, email: extra.email ?? "" };
}

const handler = createMcpHandler(
  (server) => {
    server.registerTool(
      "list_events",
      {
        title: "List calendar events",
        description:
          "Lists events on the signed-in employee's primary Google Calendar between start_date and end_date (inclusive). Use it to check for an existing out-of-office block before creating one.",
        inputSchema: z.object({ start_date: ymd, end_date: ymd }),
      },
      async ({ start_date, end_date }, ctx) => {
        const caller = callerOf(ctx.http?.authInfo);
        if (!caller) return toolError("Unauthorized: no employee is associated with this token.");
        if (end_date < start_date) return toolError("end_date must be on or after start_date.");
        try {
          const events = await listEvents(caller.token, { startYmd: start_date, endYmd: end_date });
          const lines = events.length
            ? events.map((e) => `- ${e.id} | ${e.summary} | ${e.start} → ${e.end}${e.allDay ? " (all day)" : ""}${e.vacationRequestId ? ` | request_id=${e.vacationRequestId}` : ""}`)
            : ["(no events in this range)"];
          return toolText([`${events.length} event(s) on ${caller.email}'s calendar from ${start_date} to ${end_date}:`, ...lines].join("\n"), { events });
        } catch (error) {
          return toolError(describe(error));
        }
      },
    );

    server.registerTool(
      "create_out_of_office",
      {
        title: "Create out-of-office block",
        description:
          "Creates one all-day, busy out-of-office event on the signed-in employee's primary Google Calendar for an APPROVED vacation request. Pass request_id, start_date, and end_date exactly as given in the task. Idempotent per request_id.",
        inputSchema: z.object({
          request_id: z.string().min(1).describe("The vacation request id from the task"),
          start_date: ymd,
          end_date: ymd,
          summary: z.string().max(200).optional().describe("Optional event title override"),
        }),
      },
      async ({ request_id, start_date, end_date, summary }, ctx) => {
        const caller = callerOf(ctx.http?.authInfo);
        if (!caller) return toolError("Unauthorized: no employee is associated with this token.");

        const request = await prisma.vacationRequest.findUnique({ where: { id: request_id } });
        if (!request || request.userId !== caller.userId) return toolError(`No vacation request ${request_id} exists for ${caller.email}.`);
        if (request.status !== "APPROVED") return toolError(`Request ${request_id} is ${request.status}, not APPROVED; nothing was created.`);

        const expectedStart = request.startDate.toISOString().slice(0, 10);
        const expectedEnd = request.endDate.toISOString().slice(0, 10);
        if (start_date !== expectedStart || end_date !== expectedEnd) {
          return toolError(`Dates do not match request ${request_id}. Expected start_date=${expectedStart} end_date=${expectedEnd}.`);
        }

        if (request.calendarEventId) {
          return toolText(`An out-of-office block already exists for request ${request_id}: event ${request.calendarEventId}. No new event created.\nEVENT_ID: ${request.calendarEventId}`, {
            event_id: request.calendarEventId,
            html_link: request.calendarEventHtmlLink,
            created: false,
          });
        }

        try {
          const event = await createAllDayBlock(caller.token, {
            startYmd: start_date,
            endYmd: end_date,
            summary: summary?.trim() || `Out of office — ${REASON_LABELS[request.reason]}`,
            description: `Approved time off (${REASON_LABELS[request.reason]}). Vacation request ${request_id}.`,
            requestId: request_id,
          });
          await prisma.vacationRequest.update({
            where: { id: request_id },
            data: {
              calendarEventId: event.id,
              calendarEventHtmlLink: event.htmlLink,
              calendarJobStatus: "SUCCEEDED",
              calendarJobError: null,
              calendarJobFinishedAt: new Date(),
            },
          });
          return toolText(`Created all-day out-of-office block ${event.id} from ${start_date} to ${end_date} on ${caller.email}'s calendar.\n${event.htmlLink}\nEVENT_ID: ${event.id}`, {
            event_id: event.id,
            html_link: event.htmlLink,
            created: true,
          });
        } catch (error) {
          return toolError(describe(error));
        }
      },
    );
  },
  { serverInfo: { name: "vacation-calendar", version: "1.0.0" } },
);

function describe(error: unknown): string {
  if (error instanceof GoogleCalendarError) return `Google Calendar error (${error.status}): ${error.message}`;
  return error instanceof Error ? error.message : String(error);
}

// The bearer token is the employee's Google access token, injected by Anthropic from the session's vault.
async function verifyToken(_req: Request, bearerToken?: string): Promise<AuthInfo | undefined> {
  if (!bearerToken) return undefined;
  const response = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
    headers: { authorization: `Bearer ${bearerToken}` },
  });
  if (!response.ok) return undefined;
  const profile = (await response.json()) as { sub?: string; email?: string };
  if (!profile.email) return undefined;

  const user = await prisma.user.findUnique({ where: { email: profile.email }, select: { id: true, email: true } });
  if (!user) return undefined;

  return {
    token: bearerToken,
    clientId: profile.sub ?? user.id,
    scopes: ["calendar.events"],
    extra: { userId: user.id, email: user.email },
  };
}

const authenticated = withMcpAuth(handler, verifyToken, { required: true, resourceUrl: process.env.MCP_PUBLIC_URL });

export { authenticated as GET, authenticated as POST, authenticated as DELETE };
