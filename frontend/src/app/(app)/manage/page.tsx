import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { DecisionButtons } from "@/components/decision-dialog";
import { AutoRefresh, ReconcileButton } from "@/components/job-actions";
import { RequestTable } from "@/components/request-table";
import { Card, CardContent } from "@/components/ui/card";
import { formatRange } from "@/lib/dates";
import { prisma } from "@/lib/prisma";
import { isCalendarJobActive, toRequestRow } from "@/lib/request-row";
import { REASON_LABELS } from "@/lib/requests";

export const dynamic = "force-dynamic";

export default async function ManagePage() {
  const session = await auth();
  if (session?.user.role !== "MANAGER") redirect("/requests");

  const person = { select: { name: true, email: true } };
  const [pendingRequests, decidedRequests] = await Promise.all([
    prisma.vacationRequest.findMany({ where: { status: "PENDING" }, include: { user: person }, orderBy: { createdAt: "asc" } }),
    prisma.vacationRequest.findMany({
      where: { status: { not: "PENDING" } },
      include: { user: person, decidedBy: person },
      orderBy: { decidedAt: "desc" },
      take: 50,
    }),
  ]);
  const pending = pendingRequests.map(toRequestRow);
  const decided = decidedRequests.map(toRequestRow);

  return (
    <div className="space-y-10">
      <AutoRefresh active={decided.some(isCalendarJobActive)} />

      <section className="space-y-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Approvals</h1>
          <p className="text-sm text-muted-foreground">
            {pending.length === 0 ? "No requests are waiting on you." : `${pending.length} request${pending.length === 1 ? "" : "s"} waiting for a decision.`}
          </p>
        </div>

        {pending.length > 0 && (
          <div className="grid gap-4 md:grid-cols-2">
            {pending.map((row) => (
              <Card key={row.id}>
                <CardContent className="space-y-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="font-medium">{row.requester?.name}</p>
                      <p className="text-xs text-muted-foreground">{row.requester?.email}</p>
                    </div>
                    <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium">{REASON_LABELS[row.reason]}</span>
                  </div>
                  <div>
                    <p className="text-lg font-semibold">{formatRange(row.startDate, row.endDate)}</p>
                    <p className="text-sm text-muted-foreground">
                      {row.days} {row.days === 1 ? "day" : "days"} · requested{" "}
                      {new Date(row.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                    </p>
                  </div>
                  {row.comments && <p className="rounded-md bg-muted/60 px-3 py-2 text-sm">{row.comments}</p>}
                  <DecisionButtons
                    requestId={row.id}
                    summary={`${row.requester?.name} · ${formatRange(row.startDate, row.endDate)} · ${REASON_LABELS[row.reason]}`}
                  />
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">Recent decisions</h2>
            <p className="text-sm text-muted-foreground">Approved requests are placed on the employee&apos;s Google Calendar by the calendar agent.</p>
          </div>
          <ReconcileButton />
        </div>
        <RequestTable rows={decided} showRequester emptyMessage="No decisions yet." />
      </section>
    </div>
  );
}
