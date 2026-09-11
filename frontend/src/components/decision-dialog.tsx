"use client";

import { CheckIcon, Loader2Icon, XIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type Decision = "APPROVED" | "DENIED";

export function DecisionButtons({ requestId, summary }: { requestId: string; summary: string }) {
  const router = useRouter();
  const [decision, setDecision] = useState<Decision | null>(null);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function confirm() {
    if (!decision) return;
    setSubmitting(true);
    const response = await fetch(`/api/requests/${requestId}/decision`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ decision, note: note.trim() || undefined }),
    });
    setSubmitting(false);

    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      toast.error(body.error ?? "Could not save the decision");
      if (response.status === 409) router.refresh();
      return;
    }

    if (decision === "APPROVED") {
      toast.success("Request approved", { description: "Adding the out-of-office block to the employee's calendar…" });
    } else {
      toast("Request denied");
    }
    setDecision(null);
    setNote("");
    router.refresh();
  }

  return (
    <>
      <div className="flex gap-2">
        <Button size="sm" onClick={() => setDecision("APPROVED")}>
          <CheckIcon className="size-4" />
          Approve
        </Button>
        <Button size="sm" variant="outline" onClick={() => setDecision("DENIED")}>
          <XIcon className="size-4" />
          Deny
        </Button>
      </div>

      <Dialog open={decision !== null} onOpenChange={(open) => !open && !submitting && setDecision(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{decision === "APPROVED" ? "Approve request" : "Deny request"}</DialogTitle>
            <DialogDescription>{summary}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor={`note-${requestId}`}>
              Note for the employee <span className="text-muted-foreground">(optional)</span>
            </Label>
            <Textarea id={`note-${requestId}`} value={note} onChange={(event) => setNote(event.target.value)} rows={3} maxLength={2000} />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDecision(null)} disabled={submitting}>
              Cancel
            </Button>
            <Button variant={decision === "APPROVED" ? "default" : "destructive"} onClick={confirm} disabled={submitting}>
              {submitting && <Loader2Icon className="size-4 animate-spin" />}
              {decision === "APPROVED" ? "Approve" : "Deny"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
