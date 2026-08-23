import { JWT } from "google-auth-library";

export interface BusyInterval {
  start: string;
  end: string;
}

let cachedClient: JWT | null = null;

function getAuthClient(): JWT {
  if (cachedClient) return cachedClient;

  cachedClient = new JWT({
    email: import.meta.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: import.meta.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY.replace(/\\n/g, "\n"),
    scopes: ["https://www.googleapis.com/auth/calendar"],
  });

  return cachedClient;
}

export async function queryFreeBusy(timeMin: Date, timeMax: Date): Promise<BusyInterval[]> {
  const client = getAuthClient();
  const calendarId = import.meta.env.GOOGLE_CALENDAR_ID;

  const response = await client.request<{
    calendars: Record<string, { busy: BusyInterval[] }>;
  }>({
    url: "https://www.googleapis.com/calendar/v3/freeBusy",
    method: "POST",
    data: {
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      timeZone: "America/Fortaleza",
      items: [{ id: calendarId }],
    },
  });

  return response.data.calendars[calendarId]?.busy ?? [];
}

export interface CalendarEvent {
  id: string;
  status: string;
  summary?: string;
  description?: string;
  start: { dateTime?: string };
  end: { dateTime?: string };
  extendedProperties?: { private?: { appointment_id?: string } };
}

export async function listEvents(timeMin: Date, timeMax: Date): Promise<CalendarEvent[]> {
  const client = getAuthClient();

  const response = await client.request<{ items: CalendarEvent[] }>({
    url: eventsUrl(),
    method: "GET",
    params: {
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      singleEvents: true,
      orderBy: "startTime",
    },
  });

  return response.data.items ?? [];
}

function eventsUrl(path = ""): string {
  const calendarId = import.meta.env.GOOGLE_CALENDAR_ID;
  return `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events${path}`;
}

export async function createEvent({
  summary,
  description,
  start,
  end,
  appointmentId,
}: {
  summary: string;
  description: string;
  start: string;
  end: string;
  appointmentId: string;
}): Promise<{ id: string }> {
  const client = getAuthClient();

  const response = await client.request<{ id: string }>({
    url: eventsUrl(),
    method: "POST",
    data: {
      summary,
      description,
      start: { dateTime: start, timeZone: "America/Fortaleza" },
      end: { dateTime: end, timeZone: "America/Fortaleza" },
      extendedProperties: { private: { appointment_id: appointmentId } },
    },
  });

  return { id: response.data.id };
}

export async function cancelEvent(eventId: string): Promise<void> {
  const client = getAuthClient();

  await client.request({
    url: eventsUrl(`/${encodeURIComponent(eventId)}`),
    method: "PATCH",
    data: { status: "cancelled" },
  });
}

export async function rescheduleEvent(
  eventId: string,
  { start, end }: { start: string; end: string }
): Promise<void> {
  const client = getAuthClient();

  await client.request({
    url: eventsUrl(`/${encodeURIComponent(eventId)}`),
    method: "PATCH",
    data: {
      start: { dateTime: start, timeZone: "America/Fortaleza" },
      end: { dateTime: end, timeZone: "America/Fortaleza" },
    },
  });
}
