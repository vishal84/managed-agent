import "dotenv/config";
import { parseArgs } from "node:util";
import { sessionTraceUrl } from "../frontend/src/lib/anthropic";
import { reconcileJob, startCalendarJob } from "../frontend/src/lib/calendar-agent";
import { addDaysYmd, dateToYmd, ymdToUtcDate } from "../frontend/src/lib/dates";
import { getEvent } from "../frontend/src/lib/gcal";
import { getFreshGoogleAccessToken } from "../frontend/src/lib/google-token";
import { prisma } from "../frontend/src/lib/prisma";

// End-to-end check of the approval → agent → MCP → Google Calendar path for an employee who has signed in.
//   npm run verify:e2e -- --email alice@example.com [--start 2026-10-05 --end 2026-10-07]
async function main() {
  const { values } = parseArgs({
    options: {
      email: { type: "string" },
      start: { type: "string" },
      end: { type: "string" },
      timeout: { type: "string", default: "180" },
    },
  });
  if (!values.email) throw new Error("--email is required (an employee who has signed in to the app)");

  const user = await prisma.user.findUnique({ where: { email: values.email }, include: { accounts: true } });
  if (!user) throw new Error(`No user with email ${values.email}; sign in to the app first.`);
  if (!user.accounts.some((a) => a.provider === "google" && a.refresh_token)) {
    throw new Error(`${values.email} has no Google refresh token; sign in again and accept calendar access.`);
  }

  const start = values.start ?? addDaysYmd(dateToYmd(new Date()), 14);
  const end = values.end ?? addDaysYmd(start, 2);

  const request = await prisma.vacationRequest.create({
    data: {
      userId: user.id,
      startDate: ymdToUtcDate(start),
      endDate: ymdToUtcDate(end),
      timeZone: "UTC",
      reason: "PTO",
      comments: "verify-e2e",
      status: "APPROVED",
      decidedAt: new Date(),
      decisionNote: "Auto-approved by verify-e2e",
      calendarJobStatus: "QUEUED",
    },
  });
  console.log(`Created approved request ${request.id} for ${values.email}: ${start} → ${end}`);

  await startCalendarJob(request.id);
  const started = await prisma.vacationRequest.findUniqueOrThrow({ where: { id: request.id } });
  if (started.agentSessionId) console.log(`Agent session ${started.agentSessionId}\n${sessionTraceUrl(started.agentSessionId)}`);

  const deadline = Date.now() + Number(values.timeout) * 1000;
  let current = started;
  while (current.calendarJobStatus === "RUNNING" || current.calendarJobStatus === "QUEUED") {
    if (Date.now() > deadline) throw new Error("Timed out waiting for the calendar job.");
    await new Promise((resolve) => setTimeout(resolve, 5000));
    current = (await reconcileJob(request.id)) ?? current;
    process.stdout.write(".");
  }
  console.log();

  if (current.calendarJobStatus !== "SUCCEEDED" || !current.calendarEventId) {
    throw new Error(`Calendar job ended ${current.calendarJobStatus}: ${current.calendarJobError ?? "(no error recorded)"}`);
  }

  const token = await getFreshGoogleAccessToken(user.id);
  const event = await getEvent(token.accessToken, current.calendarEventId);
  const ok = event.allDay && event.start === start && event.end === end;
  console.log(`Event ${event.id}: "${event.summary}" ${event.start} → ${event.end}${event.allDay ? " (all day)" : ""}`);
  console.log(event.htmlLink);
  if (!ok) throw new Error(`Event dates do not match the request (expected ${start} → ${end}).`);
  console.log("\nPASS: out-of-office block created on the employee's calendar.");
}

main()
  .catch((error) => {
    console.error(`\nFAIL: ${error instanceof Error ? error.message : error}`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
