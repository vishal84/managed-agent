import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { AutoRefresh } from "@/components/job-actions";
import { RequestForm } from "@/components/request-form";
import { RequestTable } from "@/components/request-table";
import { Card, CardContent } from "@/components/ui/card";
import { prisma } from "@/lib/prisma";
import { isCalendarJobActive, toRequestRow } from "@/lib/request-row";

export const dynamic = "force-dynamic";

export default async function RequestsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const requests = await prisma.vacationRequest.findMany({
    where: { userId: session.user.id },
    include: { decidedBy: { select: { name: true, email: true } } },
    orderBy: { createdAt: "desc" },
  });
  const rows = requests.map(toRequestRow);

  const year = new Date().getUTCFullYear();
  const pending = rows.filter((r) => r.status === "PENDING").length;
  const approvedDays = rows.filter((r) => r.status === "APPROVED" && r.startDate.startsWith(String(year))).reduce((sum, r) => sum + r.days, 0);
  const upcoming = rows.filter((r) => r.status === "APPROVED" && r.endDate >= new Date().toISOString().slice(0, 10)).length;

  return (
    <div className="space-y-8">
      <AutoRefresh active={rows.some(isCalendarJobActive)} />

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">My requests</h1>
          <p className="text-sm text-muted-foreground">Track your time-off requests and see when they land on your calendar.</p>
        </div>
        <RequestForm />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Awaiting approval" value={pending} />
        <Stat label={`Approved days in ${year}`} value={approvedDays} />
        <Stat label="Upcoming approved" value={upcoming} />
      </div>

      <RequestTable rows={rows} emptyMessage="You haven't requested any time off yet." />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardContent className="space-y-1">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="text-3xl font-semibold tabular-nums">{value}</p>
      </CardContent>
    </Card>
  );
}
