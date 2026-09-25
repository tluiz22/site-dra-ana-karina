import type { APIRoute } from "astro";
import { createClient } from "../../../../lib/supabase/server";
import { createBlockEvent } from "../../../../lib/google/calendar";
import { cancelAppointmentsInBulk } from "../../../../lib/scheduling/cancelAppointmentsInBulk";

function addDaysStr(dateStr: string, delta: number): string {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}

// Fase 13 etapa 2: antes de criar o bloqueio, checa se há atendimentos
// ativos no período. Se houver e `cancel_conflicts` ainda não veio no
// corpo (primeira chamada, direto do formulário), devolve a lista (com os
// ids) sem criar nada — a tela pergunta sim/não. Na segunda chamada,
// `cancel_conflicts` já vem definido e a tela reenvia os mesmos ids que
// recebeu em `conflict_appointment_ids` — cancelamos exatamente essa lista,
// sem consultar de novo (mesmo padrão do cancelamento em massa da Fase 12,
// que sempre opera sobre uma lista de ids explícita vinda do cliente, nunca
// re-derivada, evitando qualquer divergência entre o que foi mostrado e o
// que de fato é cancelado). `true` cancela a lista antes de criar o
// bloqueio (aviso por WhatsApp + link de remarcação); `false` só cria o
// bloqueio, mantendo os atendimentos como aviso/registro.
export const POST: APIRoute = async ({ request, cookies }) => {
  const body = await request.json().catch(() => ({}));
  const startDate = typeof body?.start_date === "string" ? body.start_date : undefined;
  const endDate = typeof body?.end_date === "string" ? body.end_date : undefined;
  const motivo = typeof body?.motivo === "string" ? body.motivo.trim() : "";
  const isFullDay = body?.full_day === true;
  const startTime = isFullDay ? "00:00" : typeof body?.start_time === "string" ? body.start_time : undefined;
  const endTime = isFullDay ? "00:00" : typeof body?.end_time === "string" ? body.end_time : undefined;
  const effectiveEndDate = isFullDay && endDate ? addDaysStr(endDate, 1) : endDate;
  const cancelConflicts = body?.cancel_conflicts;
  const conflictAppointmentIds = Array.isArray(body?.conflict_appointment_ids)
    ? body.conflict_appointment_ids.filter((id: unknown): id is string => typeof id === "string")
    : [];

  if (!startDate || !startTime || !effectiveEndDate || !endTime || !motivo) {
    return json({ error: "missing_fields" }, 400);
  }

  const start = new Date(`${startDate}T${startTime}:00-03:00`);
  const end = new Date(`${effectiveEndDate}T${endTime}:00-03:00`);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
    return json({ error: "invalid_range" }, 400);
  }

  const supabase = createClient(request, cookies);

  if (cancelConflicts === undefined) {
    const { data: conflicting } = await supabase
      .from("appointments")
      .select("id, scheduled_at, patients ( full_name )")
      .in("status", ["scheduled", "confirmed"])
      .gte("scheduled_at", start.toISOString())
      .lt("scheduled_at", end.toISOString());

    if (conflicting?.length) {
      return json({
        conflict: true,
        count: conflicting.length,
        appointments: conflicting.map((appointment) => ({
          id: appointment.id,
          label: (appointment.patients as unknown as { full_name: string } | null)?.full_name ?? "Paciente",
          scheduledAt: appointment.scheduled_at,
        })),
      });
    }
  } else if (cancelConflicts === true && conflictAppointmentIds.length) {
    await cancelAppointmentsInBulk(supabase, conflictAppointmentIds);
  }

  await createBlockEvent({ description: motivo, start: start.toISOString(), end: end.toISOString() });

  return json({ ok: true, redirectTo: `/admin/agenda?date=${startDate}` });
};
