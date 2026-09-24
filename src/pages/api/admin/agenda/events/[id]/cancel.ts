import type { APIRoute } from "astro";
import { createClient } from "../../../../../../lib/supabase/server";
import { cancelEvent } from "../../../../../../lib/google/calendar";
import { buildAppointmentTypeLabel, sendAppointmentCancellation } from "../../../../../../lib/whatsapp/notifications";

export const POST: APIRoute = async ({ params, request, cookies }) => {
  const { id } = params;

  if (!id) {
    return new Response(JSON.stringify({ error: "id é obrigatório" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const body = await request.json().catch(() => ({}));
  const appointmentId = typeof body?.appointmentId === "string" ? body.appointmentId : undefined;

  // Bloqueio manual/evento avulso do Calendar, sem `appointment_id` — não há
  // registro em `appointments` pra travar contra cancelamento duplicado,
  // cancela direto.
  if (!appointmentId) {
    await cancelEvent(id);
    return new Response(JSON.stringify({ ok: true }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(request, cookies);

  // Trava atômica (mesmo espírito da Fase 10, em `booking_links`): o UPDATE
  // só afeta a linha se `status` ainda não for 'canceled'. Evita cancelar de
  // novo no Calendar e mandar uma segunda notificação quando a tela estava
  // desatualizada e a consulta já tinha sido cancelada por outro canal (ex.:
  // o próprio responsável cancelando pelo bot enquanto a Agenda ainda
  // mostrava a consulta como ativa).
  const { data: appointment } = await supabase
    .from("appointments")
    .update({ status: "canceled", canceled_via: "admin" })
    .eq("id", appointmentId)
    .neq("status", "canceled")
    .select(
      "scheduled_at, appointment_type, patients ( full_name, guardians ( id, full_name, phone ) ), clinic_locations ( type ), exam_types ( name )"
    )
    .maybeSingle();

  if (!appointment) {
    return new Response(JSON.stringify({ ok: true, already_canceled: true }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  await cancelEvent(id);

  // Notificação de cancelamento por WhatsApp (Fase 3a) — melhor esforço.
  const patient = (appointment.patients ?? null) as unknown as {
    full_name: string;
    guardians: { id: string; full_name: string; phone: string } | null;
  } | null;
  const guardian = patient?.guardians ?? null;
  const location = (appointment.clinic_locations ?? null) as unknown as { type: string } | null;
  const examType = (appointment.exam_types ?? null) as unknown as { name: string } | null;

  if (patient && guardian?.phone) {
    await sendAppointmentCancellation({
      supabase,
      appointmentId,
      guardianId: guardian.id,
      guardianPhone: guardian.phone,
      patientName: patient.full_name,
      typeLabel: buildAppointmentTypeLabel(appointment.appointment_type, examType?.name),
      scheduledAt: new Date(appointment.scheduled_at),
      locationLabel: location?.type === "clinic" ? "Consultório" : location?.type === "exam" ? "Exames" : "Domiciliar",
    });
  }

  return new Response(JSON.stringify({ ok: true }), {
    headers: { "Content-Type": "application/json" },
  });
};
