import type { SupabaseClient } from "@supabase/supabase-js";
import { cancelEvent, createGroupSessionEvent, updateEventDetails } from "../google/calendar";

// Fase 11 etapa 4: uma sessão de exame em grupo (mesmo exame+data+hora) tem
// UM evento só no Google Calendar, compartilhado por todos os pacientes
// daquele horário — sem nome/telefone de paciente nenhum no evento, só a
// contagem de vagas (pedido do cliente). Quem precisa ver os pacientes um a
// um usa "Ver pacientes" nas telas de Agenda, que abre o Resumo do dia
// (lido do Supabase, não do Calendar).

function summaryFor(examName: string, booked: number, capacity: number): string {
  return `${examName} — turma (${booked}/${capacity} vagas)`;
}

function descriptionFor(booked: number, capacity: number): string {
  return `Sessão de grupo — ${booked} de ${capacity} vagas ocupadas.`;
}

async function countActiveSessionAppointments(
  supabase: SupabaseClient,
  examTypeId: string,
  scheduledAtIso: string,
  excludingAppointmentId?: string
): Promise<number> {
  let query = supabase
    .from("appointments")
    .select("id", { count: "exact", head: true })
    .eq("exam_type_id", examTypeId)
    .eq("appointment_type", "exam")
    .in("status", ["scheduled", "confirmed"])
    .eq("scheduled_at", scheduledAtIso);

  if (excludingAppointmentId) query = query.neq("id", excludingAppointmentId);

  const { count } = await query;
  return count ?? 0;
}

// Chamado logo depois de reservar a vaga (`book_group_exam_session` /
// `reschedule_group_exam_session`, já atômico) — só decide se entra num
// evento já existente daquela sessão ou cria um novo (primeiro paciente).
export async function joinOrCreateGroupSessionEvent({
  supabase,
  appointmentId,
  examTypeId,
  examName,
  capacity,
  startIso,
  endIso,
}: {
  supabase: SupabaseClient;
  appointmentId: string;
  examTypeId: string;
  examName: string;
  capacity: number;
  startIso: string;
  endIso: string;
}): Promise<string> {
  const { data: sibling } = await supabase
    .from("appointments")
    .select("id, google_event_id")
    .eq("exam_type_id", examTypeId)
    .eq("appointment_type", "exam")
    .in("status", ["scheduled", "confirmed"])
    .eq("scheduled_at", startIso)
    .neq("id", appointmentId)
    .not("google_event_id", "is", null)
    .limit(1)
    .maybeSingle();

  const booked = await countActiveSessionAppointments(supabase, examTypeId, startIso);

  if (sibling?.google_event_id) {
    await updateEventDetails(sibling.google_event_id, {
      summary: summaryFor(examName, booked, capacity),
      description: descriptionFor(booked, capacity),
    });
    return sibling.google_event_id;
  }

  const event = await createGroupSessionEvent({
    summary: summaryFor(examName, booked, capacity),
    description: descriptionFor(booked, capacity),
    start: startIso,
    end: endIso,
    examTypeId,
  });
  return event.id;
}

// Chamado ao cancelar (ou remarcar pra outra sessão, saindo desta) um
// agendamento de grupo: se ainda sobrar gente na sessão, só atualiza a
// contagem do evento; se era o último, cancela o evento de verdade.
export async function leaveGroupSessionEvent({
  supabase,
  appointmentIdLeaving,
  examTypeId,
  examName,
  capacity,
  startIso,
  googleEventId,
}: {
  supabase: SupabaseClient;
  appointmentIdLeaving: string;
  examTypeId: string;
  examName: string;
  capacity: number;
  startIso: string;
  googleEventId: string;
}): Promise<void> {
  const remaining = await countActiveSessionAppointments(supabase, examTypeId, startIso, appointmentIdLeaving);

  if (remaining <= 0) {
    await cancelEvent(googleEventId);
    return;
  }

  await updateEventDetails(googleEventId, {
    summary: summaryFor(examName, remaining, capacity),
    description: descriptionFor(remaining, capacity),
  });
}
