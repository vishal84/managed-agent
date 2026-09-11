"use client";

import { Loader2Icon, RefreshCwIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

async function post(url: string): Promise<{ ok: boolean; error?: string }> {
  const response = await fetch(url, { method: "POST" });
  const body = (await response.json().catch(() => ({}))) as { error?: string };
  return { ok: response.ok, error: body.error };
}

export function RetryCalendarButton({ requestId }: { requestId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function retry() {
    setPending(true);
    const result = await post(`/api/requests/${requestId}/retry-calendar`);
    setPending(false);
    if (result.ok) {
      toast.success("Calendar sync restarted");
      router.refresh();
    } else {
      toast.error(result.error ?? "Could not retry calendar sync");
    }
  }

  return (
    <Button variant="outline" size="sm" onClick={retry} disabled={pending}>
      {pending ? <Loader2Icon className="size-4 animate-spin" /> : <RefreshCwIcon className="size-4" />}
      Retry calendar
    </Button>
  );
}

export function ReconcileButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function reconcile() {
    setPending(true);
    const result = await post("/api/calendar-jobs/reconcile");
    setPending(false);
    if (result.ok) {
      router.refresh();
    } else {
      toast.error(result.error ?? "Could not refresh calendar jobs");
    }
  }

  return (
    <Button variant="outline" size="sm" onClick={reconcile} disabled={pending}>
      {pending ? <Loader2Icon className="size-4 animate-spin" /> : <RefreshCwIcon className="size-4" />}
      Refresh
    </Button>
  );
}

export function AutoRefresh({ active, intervalMs = 10_000 }: { active: boolean; intervalMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(timer);
  }, [active, intervalMs, router]);
  return null;
}
