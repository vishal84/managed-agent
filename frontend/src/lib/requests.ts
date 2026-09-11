import { z } from "zod";
import { LeaveReason, type CalendarJobStatus, type RequestStatus } from "@/generated/prisma/enums";
import { YMD_PATTERN } from "@/lib/dates";

export const REASON_LABELS: Record<LeaveReason, string> = {
  PTO: "PTO",
  SICK: "Sick Day",
  BEREAVEMENT: "Bereavement",
  OTHER: "Other",
};

export const STATUS_LABELS: Record<RequestStatus, string> = {
  PENDING: "Pending",
  APPROVED: "Approved",
  DENIED: "Denied",
};

export const CALENDAR_JOB_LABELS: Record<CalendarJobStatus, string> = {
  NOT_STARTED: "Not scheduled",
  QUEUED: "Queued",
  RUNNING: "Syncing to calendar",
  SUCCEEDED: "On calendar",
  FAILED: "Calendar sync failed",
};

export const MAX_CALENDAR_JOB_ATTEMPTS = 3;

const ymd = z.string().regex(YMD_PATTERN, "Expected a date in YYYY-MM-DD format");

export const createRequestSchema = z
  .object({
    startDate: ymd,
    endDate: ymd,
    timeZone: z.string().min(1).max(100),
    reason: z.enum(LeaveReason),
    comments: z.string().trim().max(2000).optional(),
  })
  .refine((v) => v.endDate >= v.startDate, {
    message: "End date must be on or after the start date",
    path: ["endDate"],
  })
  .refine((v) => v.reason !== "OTHER" || (v.comments?.length ?? 0) > 0, {
    message: "Please describe the reason for your time off",
    path: ["comments"],
  });

export type CreateRequestInput = z.infer<typeof createRequestSchema>;

export const decisionSchema = z.object({
  decision: z.enum(["APPROVED", "DENIED"]),
  note: z.string().trim().max(2000).optional(),
});

export type DecisionInput = z.infer<typeof decisionSchema>;
