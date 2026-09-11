import { addDaysYmd } from "@/lib/dates";

const EVENTS_URL = "https://www.googleapis.com/calendar/v3/calendars/primary/events";

export class GoogleCalendarError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

export interface CalendarEvent {
  id: string;
  summary: string;
  start: string;
  end: string;
  allDay: boolean;
  htmlLink: string;
  vacationRequestId?: string;
}

interface RawEvent {
  id: string;
  summary?: string;
  htmlLink?: string;
  start?: { date?: string; dateTime?: string };
  end?: { date?: string; dateTime?: string };
  extendedProperties?: { private?: Record<string, string> };
}

async function gcalFetch<T>(token: string, url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...init?.headers },
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new GoogleCalendarError(body.error?.message ?? `Google Calendar request failed (${response.status})`, response.status);
  }
  return (await response.json()) as T;
}

function toCalendarEvent(raw: RawEvent): CalendarEvent {
  const allDay = Boolean(raw.start?.date);
  return {
    id: raw.id,
    summary: raw.summary ?? "(no title)",
    start: raw.start?.date ?? raw.start?.dateTime ?? "",
    end: allDay && raw.end?.date ? addDaysYmd(raw.end.date, -1) : (raw.end?.dateTime ?? ""),
    allDay,
    htmlLink: raw.htmlLink ?? "",
    vacationRequestId: raw.extendedProperties?.private?.vacationRequestId,
  };
}

export async function listEvents(token: string, range: { startYmd: string; endYmd: string }): Promise<CalendarEvent[]> {
  const params = new URLSearchParams({
    timeMin: `${range.startYmd}T00:00:00Z`,
    timeMax: `${addDaysYmd(range.endYmd, 1)}T00:00:00Z`,
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: "50",
  });
  const data = await gcalFetch<{ items?: RawEvent[] }>(token, `${EVENTS_URL}?${params}`);
  return (data.items ?? []).map(toCalendarEvent);
}

export async function createAllDayBlock(
  token: string,
  input: { startYmd: string; endYmd: string; summary: string; description?: string; requestId: string },
): Promise<CalendarEvent> {
  const raw = await gcalFetch<RawEvent>(token, EVENTS_URL, {
    method: "POST",
    body: JSON.stringify({
      summary: input.summary,
      description: input.description,
      start: { date: input.startYmd },
      // Google treats an all-day end date as exclusive.
      end: { date: addDaysYmd(input.endYmd, 1) },
      transparency: "opaque",
      reminders: { useDefault: false },
      extendedProperties: { private: { vacationRequestId: input.requestId } },
    }),
  });
  return toCalendarEvent(raw);
}

export async function getEvent(token: string, eventId: string): Promise<CalendarEvent> {
  const raw = await gcalFetch<RawEvent>(token, `${EVENTS_URL}/${encodeURIComponent(eventId)}`);
  return toCalendarEvent(raw);
}
