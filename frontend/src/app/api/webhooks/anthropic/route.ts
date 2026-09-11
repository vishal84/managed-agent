import { anthropic } from "@/lib/anthropic";
import { reconcileJob } from "@/lib/calendar-agent";
import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const SESSION_DONE_EVENTS = new Set(["session.status_idled", "session.status_terminated", "session.idled"]);

export async function POST(req: Request) {
  const key = env.webhookSigningKey();
  if (!key) return Response.json({ error: "ANTHROPIC_WEBHOOK_SIGNING_KEY is not configured" }, { status: 503 });

  const raw = await req.text();
  let event;
  try {
    event = anthropic.beta.webhooks.unwrap(raw, { headers: Object.fromEntries(req.headers), key });
  } catch (error) {
    console.warn("[webhook] rejected payload", error);
    return Response.json({ error: "Invalid signature" }, { status: 400 });
  }

  // Deliveries can repeat and arrive out of order; process each event id once.
  try {
    await prisma.processedWebhook.create({ data: { id: event.id } });
  } catch {
    return Response.json({ ok: true, duplicate: true });
  }

  if (SESSION_DONE_EVENTS.has(event.data.type)) {
    const request = await prisma.vacationRequest.findFirst({
      where: { agentSessionId: event.data.id, calendarJobStatus: "RUNNING" },
      select: { id: true },
    });
    if (request) {
      await reconcileJob(request.id).catch((error) => console.error(`[webhook] reconcile ${request.id} failed`, error));
    }
  }

  return Response.json({ ok: true });
}
