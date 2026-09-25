import type { SupabaseClient } from "@supabase/supabase-js";
import { cancelEvent } from "../google/calendar";
import { leaveGroupSessionEvent } from "./groupSessionCalendar";
import { buildAppointmentTypeLabel, sendMassCancellationNotice } from "../whatsapp/notifications";
import { buildAppUrl } from "../whatsapp/bot/shared";

// Notificação passiva (sem conversa ativa em andamento) — validade bem maior
// que os 30min padrão dos links gerados pelo bot no meio de uma conversa.
const LINK_EXPIRY_MS = 2 * 24 * 60 * 60 * 1000;

// Rotina de cancelamento em massa (Fase 12), extraída pra ser reaproveitada
// também pelo bloqueio de agenda (Fase 13 etapa 2) quando o admin escolhe
// cancelar os atendimentos que caem dentro do período bloqueado. Cancela
// cada `appointmentId` (trava atômica contra dupla ação, cancela no
// Calendar, marca canceled), gera um link de remarcação novo (válido por 2
// dias) e avisa por WhatsApp com o motivo fixo "imprevisto da médica" —
// melhor esforço: uma falha isolada não trava os demais.
export async function cancelAppointmentsInBulk(
  supabase: SupabaseClient,
  appointmentIds: string[]
): Promise<{ canceled: number; skipped: number }> {
  let canceled = 0;
  let skipped = 0;

  for (const appointmentId of appointmentIds) {
    // Mesma trava atômica do cancelamento individual (events/[id]/cancel):
    // só segue se a consulta ainda não estava cancelada.
    const { data: appointment } = await supabase
      .from("appointments")
      .update({ status: "canceled", canceled_via: "admin", canceled_at: new Date().toISOString() })
      .eq("id", appointmentId)
      .neq("status", "canceled")
      .select(
        "patient_id, scheduled_at, appointment_type, exam_type_id, google_event_id, clinic_location_id, patients ( full_name, guardians ( id, full_name, phone ) ), clinic_locations ( type ), exam_types ( id, name, scheduling_mode )"
      )
      .maybeSingle();

    if (!appointment) {
      skipped += 1;
      continue;
    }
    canceled += 1;

    const examType = (appointment.exam_types ?? null) as unknown as { id: string; name: string; scheduling_mode: string } | null;
    const isGroupExam = appointment.appointment_type === "exam" && examType?.scheduling_mode === "group";

    if (appointment.google_event_id) {
      try {
        if (isGroupExam && appointment.exam_type_id) {
          // Sessão de grupo: sai do evento compartilhado (atualiza a
          // contagem) em vez de cancelar o evento de todo mundo.
          const weekday = new Date(new Date(appointment.scheduled_at).getTime() - 3 * 60 * 60 * 1000).getUTCDay();
          const time = new Date(new Date(appointment.scheduled_at).getTime() - 3 * 60 * 60 * 1000)
            .toISOString()
            .slice(11, 16);
          const { data: window } = await supabase
            .from("exam_type_availability_windows")
            .select("capacity")
            .eq("exam_type_id", appointment.exam_type_id)
            .eq("weekday", weekday)
            .eq("start_time", `${time}:00`)
            .eq("is_active", true)
            .maybeSingle();

          await leaveGroupSessionEvent({
            supabase,
            appointmentIdLeaving: appointmentId,
            examTypeId: appointment.exam_type_id,
            examName: examType?.name ?? "Exame",
            capacity: window?.capacity ?? 1,
            startIso: appointment.scheduled_at,
            googleEventId: appointment.google_event_id,
          });
        } else {
          await cancelEvent(appointment.google_event_id);
        }
      } catch (err) {
        console.error(
          "[cancelamento em massa] erro ao cancelar evento no Calendar:",
          appointmentId,
          err instanceof Error ? err.message : String(err)
        );
      }
    }

    const patient = (appointment.patients ?? null) as unknown as {
      full_name: string;
      guardians: { id: string; full_name: string; phone: string } | null;
    } | null;
    const guardian = patient?.guardians ?? null;
    const location = (appointment.clinic_locations ?? null) as unknown as { type: string } | null;
    const isExam = appointment.appointment_type === "exam";

    if (!patient || !guardian?.phone) continue;

    // Gera um link novo (modo "create" — a consulta cancelada já morreu,
    // não é uma remarcação da mesma linha) com validade de 2 dias.
    const { data: link, error: linkError } = await supabase
      .from("booking_links")
      .insert({
        guardian_id: guardian.id,
        patient_id: appointment.patient_id,
        clinic_location_id: isExam ? appointment.clinic_location_id : null,
        location_category: isExam ? null : location?.type === "home_visit" ? "home_visit" : "clinic",
        appointment_type: appointment.appointment_type,
        exam_type_id: isExam ? (examType?.id ?? appointment.exam_type_id) : null,
        mode: "create",
        guardian_phone: guardian.phone,
        expires_at: new Date(Date.now() + LINK_EXPIRY_MS).toISOString(),
      })
      .select("id")
      .single();

    if (linkError || !link) {
      console.error("[cancelamento em massa] erro ao gerar link de agendamento:", appointmentId, linkError?.message);
      continue;
    }

    await sendMassCancellationNotice({
      supabase,
      appointmentId,
      guardianId: guardian.id,
      guardianPhone: guardian.phone,
      patientName: patient.full_name,
      typeLabel: buildAppointmentTypeLabel(appointment.appointment_type, examType?.name),
      scheduledAt: new Date(appointment.scheduled_at),
      locationLabel: location?.type === "clinic" ? "Consultório" : location?.type === "exam" ? "Exames" : "Domiciliar",
      link: buildAppUrl(`/agendar/${link.id}`),
    });
  }

  return { canceled, skipped };
}
