import { RetryCalendarButton } from "@/components/job-actions";
import { CalendarSyncBadge, StatusBadge } from "@/components/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatRange } from "@/lib/dates";
import type { RequestRow } from "@/lib/request-row";
import { MAX_CALENDAR_JOB_ATTEMPTS, REASON_LABELS } from "@/lib/requests";

export function RequestTable({
  rows,
  showRequester = false,
  emptyMessage = "No requests yet.",
}: {
  rows: RequestRow[];
  showRequester?: boolean;
  emptyMessage?: string;
}) {
  if (rows.length === 0) {
    return <p className="rounded-lg border border-dashed px-6 py-10 text-center text-sm text-muted-foreground">{emptyMessage}</p>;
  }

  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            {showRequester && <TableHead>Employee</TableHead>}
            <TableHead>Dates</TableHead>
            <TableHead>Reason</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Calendar</TableHead>
            <TableHead className="text-right">Requested</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const canRetry =
              row.status === "APPROVED" && row.calendarJobStatus === "FAILED" && row.calendarJobAttempts < MAX_CALENDAR_JOB_ATTEMPTS;
            return (
              <TableRow key={row.id}>
                {showRequester && (
                  <TableCell>
                    <p className="font-medium">{row.requester?.name}</p>
                    <p className="text-xs text-muted-foreground">{row.requester?.email}</p>
                  </TableCell>
                )}
                <TableCell>
                  <p className="font-medium">{formatRange(row.startDate, row.endDate)}</p>
                  <p className="text-xs text-muted-foreground">
                    {row.days} {row.days === 1 ? "day" : "days"}
                  </p>
                </TableCell>
                <TableCell>
                  <p>{REASON_LABELS[row.reason]}</p>
                  {row.comments && <p className="max-w-xs truncate text-xs text-muted-foreground" title={row.comments}>{row.comments}</p>}
                </TableCell>
                <TableCell>
                  <StatusBadge status={row.status} />
                  {row.decisionNote && <p className="mt-1 max-w-xs truncate text-xs text-muted-foreground" title={row.decisionNote}>“{row.decisionNote}”</p>}
                </TableCell>
                <TableCell>
                  <div className="flex flex-col items-start gap-2">
                    <CalendarSyncBadge row={row} />
                    {canRetry && <RetryCalendarButton requestId={row.id} />}
                  </div>
                </TableCell>
                <TableCell className="text-right text-sm text-muted-foreground">
                  {new Date(row.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
