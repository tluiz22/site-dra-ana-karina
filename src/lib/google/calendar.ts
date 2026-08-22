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
