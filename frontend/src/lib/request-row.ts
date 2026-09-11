import type { CalendarJobStatus, LeaveReason, RequestStatus, VacationRequest } from "@/generated/prisma/client";
import { dateToYmd, daysInclusive } from "@/lib/dates";

export interface RequestRow {
  id: string;
  requester: { name: string; email: string } | null;
  startDate: string;
  endDate: string;
  days: number;
  reason: LeaveReason;
  comments: string | null;
  status: RequestStatus;
  createdAt: string;
  decidedAt: string | null;
  decidedBy: string | null;
  decisionNote: string | null;
  calendarJobStatus: CalendarJobStatus;
  calendarJobAttempts: number;
  calendarEventHtmlLink: string | null;
  calendarJobError: string | null;
  agentSessionId: string | null;
}

type Person = { name: string | null; email: string | null } | null;

export function toRequestRow(request: VacationRequest & { user?: Person; decidedBy?: Person }): RequestRow {
  const startDate = dateToYmd(request.startDate);
  const endDate = dateToYmd(request.endDate);
  return {
    id: request.id,
    requester: request.user ? { name: request.user.name ?? request.user.email ?? "Unknown", email: request.user.email ?? "" } : null,
    startDate,
    endDate,
    days: daysInclusive(startDate, endDate),
    reason: request.reason,
    comments: request.comments,
    status: request.status,
    createdAt: request.createdAt.toISOString(),
    decidedAt: request.decidedAt?.toISOString() ?? null,
    decidedBy: request.decidedBy?.name ?? request.decidedBy?.email ?? null,
    decisionNote: request.decisionNote,
    calendarJobStatus: request.calendarJobStatus,
    calendarJobAttempts: request.calendarJobAttempts,
    calendarEventHtmlLink: request.calendarEventHtmlLink,
    calendarJobError: request.calendarJobError,
    agentSessionId: request.agentSessionId,
  };
}

export function isCalendarJobActive(row: Pick<RequestRow, "calendarJobStatus">): boolean {
  return row.calendarJobStatus === "QUEUED" || row.calendarJobStatus === "RUNNING";
}
