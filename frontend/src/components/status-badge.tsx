import { AlertCircleIcon, CalendarCheckIcon, ExternalLinkIcon, Loader2Icon } from "lucide-react";
import type { RequestStatus } from "@/generated/prisma/client";
import { Badge } from "@/components/ui/badge";
import type { RequestRow } from "@/lib/request-row";
import { CALENDAR_JOB_LABELS, STATUS_LABELS } from "@/lib/requests";
import { cn } from "@/lib/utils";

const STATUS_CLASSES: Record<RequestStatus, string> = {
  PENDING: "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200",
  APPROVED: "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
  DENIED: "border-red-300 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200",
};

export function StatusBadge({ status }: { status: RequestStatus }) {
  return (
    <Badge variant="outline" className={cn("font-medium", STATUS_CLASSES[status])}>
      {STATUS_LABELS[status]}
    </Badge>
  );
}

export function CalendarSyncBadge({ row }: { row: Pick<RequestRow, "status" | "calendarJobStatus" | "calendarEventHtmlLink" | "calendarJobError"> }) {
  if (row.status !== "APPROVED") return <span className="text-sm text-muted-foreground">—</span>;

  switch (row.calendarJobStatus) {
    case "SUCCEEDED":
      return (
        <a
          href={row.calendarEventHtmlLink ?? "#"}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-emerald-700 hover:underline dark:text-emerald-300"
        >
          <CalendarCheckIcon className="size-4" />
          {CALENDAR_JOB_LABELS.SUCCEEDED}
          <ExternalLinkIcon className="size-3 opacity-60" />
        </a>
      );
    case "FAILED":
      return (
        <span className="inline-flex items-start gap-1.5 text-sm text-red-700 dark:text-red-300" title={row.calendarJobError ?? undefined}>
          <AlertCircleIcon className="mt-0.5 size-4 shrink-0" />
          <span>
            {CALENDAR_JOB_LABELS.FAILED}
            {row.calendarJobError && <span className="block max-w-xs truncate text-xs text-muted-foreground">{row.calendarJobError}</span>}
          </span>
        </span>
      );
    case "QUEUED":
    case "RUNNING":
      return (
        <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
          <Loader2Icon className="size-4 animate-spin" />
          {CALENDAR_JOB_LABELS[row.calendarJobStatus]}
        </span>
      );
    default:
      return <span className="text-sm text-muted-foreground">{CALENDAR_JOB_LABELS.NOT_STARTED}</span>;
  }
}
