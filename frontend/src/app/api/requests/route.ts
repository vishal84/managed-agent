import { auth } from "@/auth";
import { ymdToUtcDate } from "@/lib/dates";
import { prisma } from "@/lib/prisma";
import { createRequestSchema } from "@/lib/requests";

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = createRequestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  }

  const { startDate, endDate, timeZone, reason, comments } = parsed.data;
  const request = await prisma.vacationRequest.create({
    data: {
      userId: session.user.id,
      startDate: ymdToUtcDate(startDate),
      endDate: ymdToUtcDate(endDate),
      timeZone,
      reason,
      comments: comments || null,
    },
  });

  return Response.json({ id: request.id, status: request.status }, { status: 201 });
}
