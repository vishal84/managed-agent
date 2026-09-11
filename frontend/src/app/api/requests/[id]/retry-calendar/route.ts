import { after } from "next/server";
import { auth } from "@/auth";
import { startCalendarJob } from "@/lib/calendar-agent";
import { prisma } from "@/lib/prisma";
import { MAX_CALENDAR_JOB_ATTEMPTS } from "@/lib/requests";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const request = await prisma.vacationRequest.findUnique({ where: { id } });
  if (!request) return Response.json({ error: "Not found" }, { status: 404 });
  if (session.user.role !== "MANAGER" && request.userId !== session.user.id) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  if (request.status !== "APPROVED" || request.calendarJobStatus !== "FAILED") {
    return Response.json({ error: "Only a failed calendar sync on an approved request can be retried" }, { status: 409 });
  }
  if (request.calendarJobAttempts >= MAX_CALENDAR_JOB_ATTEMPTS) {
    return Response.json({ error: `Retry limit of ${MAX_CALENDAR_JOB_ATTEMPTS} reached` }, { status: 409 });
  }

  await prisma.vacationRequest.update({ where: { id }, data: { calendarJobStatus: "QUEUED", calendarJobError: null } });
  after(() => startCalendarJob(id));

  return Response.json({ id, calendarJobStatus: "QUEUED" });
}
