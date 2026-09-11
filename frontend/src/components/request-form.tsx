"use client";

import { format } from "date-fns";
import { CalendarIcon, Loader2Icon, PlusIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { DateRange } from "react-day-picker";
import { toast } from "sonner";
import { LeaveReason } from "@/generated/prisma/enums";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { REASON_LABELS } from "@/lib/requests";

const REASONS = Object.values(LeaveReason);

function describeRange(range: DateRange | undefined): string {
  if (!range?.from) return "Pick dates";
  if (!range.to || range.to.getTime() === range.from.getTime()) return format(range.from, "EEE, MMM d, yyyy");
  return `${format(range.from, "MMM d")} – ${format(range.to, "MMM d, yyyy")}`;
}

export function RequestForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [range, setRange] = useState<DateRange | undefined>();
  const [reason, setReason] = useState<LeaveReason | "">("");
  const [comments, setComments] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setRange(undefined);
    setReason("");
    setComments("");
    setError(null);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!range?.from) return setError("Choose the days you'll be away.");
    if (!reason) return setError("Choose a reason.");
    if (reason === "OTHER" && comments.trim().length === 0) return setError("Please describe the reason for your time off.");

    setSubmitting(true);
    setError(null);
    const response = await fetch("/api/requests", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        startDate: format(range.from, "yyyy-MM-dd"),
        endDate: format(range.to ?? range.from, "yyyy-MM-dd"),
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        reason,
        comments: comments.trim() || undefined,
      }),
    });
    setSubmitting(false);

    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      setError(body.error ?? "Could not submit your request.");
      return;
    }

    toast.success("Request submitted", { description: "Your manager will be notified for approval." });
    setOpen(false);
    reset();
    router.refresh();
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger render={<Button />}>
        <PlusIcon className="size-4" />
        Request time off
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={submit} className="space-y-5">
          <DialogHeader>
            <DialogTitle>Request time off</DialogTitle>
            <DialogDescription>Pick your dates and a reason. Once approved, the days are blocked on your Google Calendar.</DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label>Dates</Label>
            <Popover>
              <PopoverTrigger render={<Button type="button" variant="outline" className="w-full justify-start font-normal" />}>
                <CalendarIcon className="size-4 text-muted-foreground" />
                {describeRange(range)}
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar mode="range" selected={range} onSelect={setRange} numberOfMonths={2} disabled={{ before: today }} autoFocus />
              </PopoverContent>
            </Popover>
          </div>

          <div className="space-y-2">
            <Label htmlFor="reason">Reason</Label>
            <Select value={reason} onValueChange={(value) => setReason(value as LeaveReason)}>
              <SelectTrigger id="reason" className="w-full">
                <SelectValue placeholder="Select a reason" />
              </SelectTrigger>
              <SelectContent>
                {REASONS.map((value) => (
                  <SelectItem key={value} value={value}>
                    {REASON_LABELS[value]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="comments">
              Comments {reason === "OTHER" ? <span className="text-destructive">*</span> : <span className="text-muted-foreground">(optional)</span>}
            </Label>
            <Textarea
              id="comments"
              value={comments}
              onChange={(event) => setComments(event.target.value)}
              placeholder={reason === "OTHER" ? "Tell your manager why you need this time off" : "Anything your manager should know"}
              rows={3}
              maxLength={2000}
            />
          </div>

          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting && <Loader2Icon className="size-4 animate-spin" />}
              Submit request
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
