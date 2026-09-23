import type { APIRoute } from "astro";
import { createServiceClient } from "../../../lib/supabase/service";
import { listEvents } from "../../../lib/google/calendar";
import { sendDailySummaryMessage } from "../../../lib/whatsapp/dailySummary";
import { TIMEZONE } from "../../../lib/whatsapp/formatDateTime";

// Cron da Vercel (ver `vercel.json`) — dois disparos por dia, mesmo endpoint,
// diferenciados só pelo parâmetro `send`:
//   - `send=preview` (Envio A, ~18h Fortaleza da véspera): mira o dia
//     seguinte ("amanhã", relativo ao momento do disparo).
//   - `send=final` (Envio B, ~06h30 Fortaleza): mira o dia de hoje (relativo
//     ao momento do disparo) — como B dispara na manhã do próprio dia dos
//     atendimentos, "hoje" ali é o mesmo dia-calendário que era "amanhã"
//     quando A disparou na véspera. Os dois nunca miram dias diferentes,
//     desde que os horários no vercel.json não sejam alterados.
// Cada resumo (consultas/exames) é avaliado de forma independente: lista
// vazia = não envia aquele resumo, silenciosamente (nunca manda "nada
// marcado").

function todayFortaleza(): string {
  return new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function addDays(dateStr: string, delta: number): string {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

function formatTimeFortaleza(date: Date): string {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
    .format(date)
    .replace(":", "h");
}

interface AppointmentRow {
  id: string;
  google_event_id: string | null;
  scheduled_at: string;
  appointment_type: string;
  patients: { full_name: string } | { full_name: string }[] | null;
}

function patientName(row: AppointmentRow): string {
  const patient = Array.isArray(row.patients) ? row.patients[0] : row.patients;
  return patient?.full_name ?? "Paciente";
}

// "09h00 - João Silva · 10h30 - Maria Souza" — parâmetros de corpo de
// template da Meta não aceitam quebra de linha, a lista inteira fica numa
// linha só, itens já ordenados por horário (a query abaixo ordena).
function buildListText(rows: AppointmentRow[]): string {
  return rows.map((row) => `${formatTimeFortaleza(new Date(row.scheduled_at))} - ${patientName(row)}`).join(" · ");
}

export const GET: APIRoute = async ({ request, url }) => {
  const cronSecret = import.meta.env.CRON_SECRET;
  if (!cronSecret) {
    return json({ error: "CRON_SECRET não configurada" }, 500);
  }
  if (request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return json({ error: "não autorizado" }, 401);
  }

  const send = url.searchParams.get("send");
  if (send !== "preview" && send !== "final") {
    return json({ error: "parâmetro send inválido — use preview ou final" }, 400);
  }

  const supabase = createServiceClient();

  const targetDate = send === "preview" ? addDays(todayFortaleza(), 1) : todayFortaleza();
  const dayStart = new Date(`${targetDate}T00:00:00-03:00`);
  const dayEnd = new Date(`${addDays(targetDate, 1)}T00:00:00-03:00`);

  const { data: candidates, error } = await supabase
    .from("appointments")
    .select("id, google_event_id, scheduled_at, appointment_type, patients ( full_name )")
    .in("status", ["scheduled", "confirmed"])
    .gte("scheduled_at", dayStart.toISOString())
    .lt("scheduled_at", dayEnd.toISOString())
    .order("scheduled_at");

  if (error) {
    return json({ error: error.message }, 500);
  }

  // O Calendar é a fonte da verdade: descarta o que foi cancelado pelo
  // celular e o Supabase ainda não sabe (mesma leitura já feita no cron de
  // lembrete).
  let activeEventIds: Set<string> | null = null;
  try {
    const events = await listEvents(dayStart, dayEnd);
    activeEventIds = new Set(events.filter((e) => e.status !== "cancelled").map((e) => e.id));
  } catch (err) {
    console.error(
      "[cron daily-summary] falha ao ler o Calendar — seguindo apenas com o status do Supabase:",
      err instanceof Error ? err.message : String(err)
    );
  }

  const active = ((candidates ?? []) as AppointmentRow[]).filter(
    (a) => !activeEventIds || !a.google_event_id || activeEventIds.has(a.google_event_id)
  );

  const consultas = active.filter((a) => a.appointment_type === "first_visit" || a.appointment_type === "return_visit");
  const exames = active.filter((a) => a.appointment_type === "exam");

  const results: Record<string, string> = {};

  if (consultas.length > 0) {
    const { data: recipients } = await supabase
      .from("notification_recipients")
      .select("phone")
      .eq("is_active", true)
      .eq("receives_consultas", true);

    if (!recipients?.length) {
      console.warn("[cron daily-summary] sem destinatário ativo para resumo de consultas — não enviado.");
    } else {
      const listText = buildListText(consultas);
      for (const recipient of recipients) {
        results[`consultas:${recipient.phone}`] = await sendDailySummaryMessage({
          supabase,
          to: recipient.phone,
          templateName: import.meta.env.WHATSAPP_TEMPLATE_DAILY_SUMMARY_CONSULTAS,
          messageType: "daily_summary_consultas",
          listText,
        });
      }
    }
  }

  if (exames.length > 0) {
    const { data: recipients } = await supabase
      .from("notification_recipients")
      .select("phone")
      .eq("is_active", true)
      .eq("receives_exames", true);

    if (!recipients?.length) {
      console.warn("[cron daily-summary] sem destinatário ativo para resumo de exames — não enviado.");
    } else {
      const listText = buildListText(exames);
      for (const recipient of recipients) {
        results[`exames:${recipient.phone}`] = await sendDailySummaryMessage({
          supabase,
          to: recipient.phone,
          templateName: import.meta.env.WHATSAPP_TEMPLATE_DAILY_SUMMARY_EXAMES,
          messageType: "daily_summary_exames",
          listText,
        });
      }
    }
  }

  return json({ send, targetDate, consultas: consultas.length, exames: exames.length, results });
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
