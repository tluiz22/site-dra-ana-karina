import { JWT } from "google-auth-library";

export interface BusyInterval {
  start: string;
  end: string;
}

let cachedClient: JWT | null = null;

// A chave da service account chega de formas diferentes conforme a origem:
// - Vercel: PEM com quebras de linha reais;
// - `.env` local em PEM: numa linha só com `\n` literais, às vezes entre
//   aspas — frágil, qualquer edição do arquivo pode truncar a chave;
// - `.env` local em base64 (recomendado): o PEM inteiro codificado em
//   base64, sem quebras de linha nem escapes para dar errado.
// Sem normalizar, o OpenSSL 3 falha com
// "error:1E08010C:DECODER routines::unsupported".
function normalizePrivateKey(raw: string | undefined): string {
  if (!raw) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY não configurada.");
  }

  let key = raw.trim();

  if (
    (key.startsWith('"') && key.endsWith('"')) ||
    (key.startsWith("'") && key.endsWith("'"))
  ) {
    key = key.slice(1, -1);
  }

  // Não parece PEM → assume que é o PEM inteiro em base64.
  if (!key.includes("-----BEGIN")) {
    key = Buffer.from(key, "base64").toString("utf8").trim();
  }

  key = key.replace(/\\n/g, "\n").trim();

  if (!key.includes("-----BEGIN") || !key.includes("PRIVATE KEY-----")) {
    throw new Error(
      "GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY inválida: não é um PEM (-----BEGIN ... PRIVATE KEY-----) nem um base64 que decodifica para um."
    );
  }

  return key.endsWith("\n") ? key : `${key}\n`;
}

function getAuthClient(): JWT {
  if (cachedClient) return cachedClient;

  cachedClient = new JWT({
    email: import.meta.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: normalizePrivateKey(import.meta.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY),
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
  // `appointment_id`: evento normal, 1 agendamento = 1 evento.
  // `group_exam_type_id`: evento de sessão de exame em grupo (Fase 11 etapa
  // 4), compartilhado por vários agendamentos — não tem um único
  // `appointment_id` pra apontar, de propósito (ver "Ver pacientes" nas
  // telas de Agenda).
  extendedProperties?: { private?: { appointment_id?: string; group_exam_type_id?: string } };
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
      showDeleted: true,
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

// Sessão de exame em grupo (Fase 11 etapa 4): um único evento compartilhado
// por todos os pacientes daquele horário, sem nome de paciente nenhum
// (só a contagem de vagas ocupadas) — pedido do cliente. Criado só pelo
// primeiro paciente da sessão; os seguintes reaproveitam o mesmo evento via
// `updateEventDetails`.
export async function createGroupSessionEvent({
  summary,
  description,
  start,
  end,
  examTypeId,
}: {
  summary: string;
  description: string;
  start: string;
  end: string;
  examTypeId: string;
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
      extendedProperties: { private: { group_exam_type_id: examTypeId } },
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

// Usado pelo exame em grupo (Fase 11 etapa 4) pra atualizar a contagem de
// vagas ocupadas no evento compartilhado da sessão, sem mexer no horário.
export async function updateEventDetails(
  eventId: string,
  { summary, description }: { summary: string; description: string }
): Promise<void> {
  const client = getAuthClient();

  await client.request({
    url: eventsUrl(`/${encodeURIComponent(eventId)}`),
    method: "PATCH",
    data: { summary, description },
  });
}
