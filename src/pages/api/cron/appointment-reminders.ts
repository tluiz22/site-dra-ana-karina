import type { APIRoute } from "astro";
import { createServiceClient } from "../../../lib/supabase/service";
import { listEvents } from "../../../lib/google/calendar";
import { buildAppointmentTypeLabel, sendAppointmentReminder } from "../../../lib/whatsapp/notifications";

// Cron da Vercel (ver `vercel.json`). Dispara o lembrete de consulta para
// todo agendamento ativo nas próximas ~26h que ainda não recebeu lembrete
// (`reminder_sent_at is null`). Com o cron rodando 1x/dia, cada consulta
// recebe exatamente um lembrete, na primeira execução que cai dentro da
// janela — na prática, "no dia anterior".
//
// A Vercel injeta `Authorization: Bearer <CRON_SECRET>` automaticamente
// quando a env var CRON_SECRET existe no projeto.

const WINDOW_HOURS = 26;

export const GET: APIRoute = async ({ request }) => {
  const cronSecret = import.meta.env.CRON_SECRET;
  if (!cronSecret) {
    return json({ error: "CRON_SECRET não configurada" }, 500);
  }
  if (request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return json({ error: "não autorizado" }, 401);
  }

  const supabase = createServiceClient();

  const now = new Date();
  const windowEnd = new Date(now.getTime() + WINDOW_HOURS * 60 * 60 * 1000);

  const { data: candidates, error } = await supabase
    .from("appointments")
    .select(
      "id, google_event_id, scheduled_at, appointment_type, clinic_locations ( type, address ), exam_types ( name ), patients ( full_name, guardians ( id, full_name, phone ) )"
    )
    .in("status", ["scheduled", "confirmed"])
    .is("reminder_sent_at", null)
    .gt("scheduled_at", now.toISOString())
    .lte("scheduled_at", windowEnd.toISOString());

  if (error) {
    return json({ error: error.message }, 500);
  }

  if (!candidates || candidates.length === 0) {
    return json({ candidates: 0, sent: 0, failed: 0, skipped: 0 });
  }

  // O Calendar é a fonte da verdade: se alguém cancelou pelo celular, o
  // `status` no Supabase pode estar defasado. Uma única leitura da janela
  // resolve para o lote inteiro.
  let activeEventIds: Set<string> | null = null;
  try {
    const events = await listEvents(now, windowEnd);
    activeEventIds = new Set(
      events.filter((e) => e.status !== "cancelled").map((e) => e.id)
    );
  } catch (err) {
    console.error(
      "[cron reminders] falha ao ler o Calendar — seguindo apenas com o status do Supabase:",
      err instanceof Error ? err.message : String(err)
    );
  }

  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const appointment of candidates) {
    if (
      activeEventIds &&
      appointment.google_event_id &&
      !activeEventIds.has(appointment.google_event_id)
    ) {
      // Evento cancelado/ausente no Calendar — não lembra.
      continue;
    }

    const patient = (appointment.patients ?? null) as unknown as {
      full_name: string;
      guardians: { id: string; full_name: string; phone: string } | null;
    } | null;
    const guardian = patient?.guardians ?? null;
    const location = (appointment.clinic_locations ?? null) as unknown as {
      type: string;
      address: string | null;
    } | null;
    const examType = (appointment.exam_types ?? null) as unknown as { name: string } | null;

    if (!patient || !guardian?.phone) {
      continue;
    }

    const status = await sendAppointmentReminder({
      supabase,
      appointmentId: appointment.id,
      guardianId: guardian.id,
      guardianPhone: guardian.phone,
      patientName: patient.full_name,
      typeLabel: buildAppointmentTypeLabel(appointment.appointment_type, examType?.name),
      scheduledAt: new Date(appointment.scheduled_at),
      locationLabel: location?.type === "clinic" ? "Consultório" : location?.type === "exam" ? "Exames" : "Domiciliar",
      locationAddress: location?.address ?? null,
    });

    if (status === "sent") sent++;
    else if (status === "failed") failed++;
    else skipped++;

    // Em falha, deixa `reminder_sent_at` nulo para o próximo cron tentar de
    // novo (ainda dentro da janela de 26h). Nos demais casos, marca como
    // enviado para não repetir.
    if (status !== "failed") {
      await supabase
        .from("appointments")
        .update({ reminder_sent_at: new Date().toISOString() })
        .eq("id", appointment.id);
    }
  }

  return json({ candidates: candidates.length, sent, failed, skipped });
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
