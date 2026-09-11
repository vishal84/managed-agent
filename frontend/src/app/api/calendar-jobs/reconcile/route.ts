import { auth } from "@/auth";
import { reconcileStaleJobs } from "@/lib/calendar-agent";

export async function POST() {
  const session = await auth();
  if (!session?.user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "MANAGER") return Response.json({ error: "Managers only" }, { status: 403 });

  const checked = await reconcileStaleJobs();
  return Response.json({ checked });
}
