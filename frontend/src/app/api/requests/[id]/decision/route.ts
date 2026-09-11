import { after } from "next/server";
import { auth } from "@/auth";
import { startCalendarJob } from "@/lib/calendar-agent";
import { prisma } from "@/lib/prisma";
import { decisionSchema } from "@/lib/requests";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "MANAGER") return Response.json({ error: "Managers only" }, { status: 403 });

  const parsed = decisionSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  }

  const { id } = await params;
  const { decision, note } = parsed.data;

  // Only a PENDING request can be decided, which also makes a double-click a no-op.
  const { count } = await prisma.vacationRequest.updateMany({
    where: { id, status: "PENDING" },
    data: {
      status: decision,
      decidedById: session.user.id,
      decidedAt: new Date(),
      decisionNote: note || null,
      calendarJobStatus: decision === "APPROVED" ? "QUEUED" : "NOT_STARTED",
    },
  });
  if (count === 0) return Response.json({ error: "This request has already been decided" }, { status: 409 });

  if (decision === "APPROVED") after(() => startCalendarJob(id));

  return Response.json({ id, status: decision });
}
