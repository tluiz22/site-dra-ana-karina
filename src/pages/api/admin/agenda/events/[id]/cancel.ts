import type { APIRoute } from "astro";
import { createClient } from "../../../../../../lib/supabase/server";
import { cancelEvent } from "../../../../../../lib/google/calendar";
import { sendAppointmentCancellation } from "../../../../../../lib/whatsapp/notifications";

export const POST: APIRoute = async ({ params, request, cookies }) => {
  const { id } = params;

  if (!id) {
    return new Response(JSON.stringify({ error: "id é obrigatório" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  await cancelEvent(id);

  const body = await request.json().catch(() => ({}));
  const appointmentId = typeof body?.appointmentId === "string" ? body.appointmentId : undefined;

  if (appointmentId) {
    const supabase = createClient(request, cookies);

    const { data: appointment } = await supabase
      .from("appointments")
      .select(
        "scheduled_at, patients ( full_name, guardians ( id, full_name, phone ) ), clinic_locations ( type )"
      )
      .eq("id", appointmentId)
      .single();

    await supabase.from("appointments").update({ status: "canceled" }).eq("id", appointmentId);

    // Notificação de cancelamento por WhatsApp (Fase 3a) — melhor esforço.
    const patient = (appointment?.patients ?? null) as unknown as {
      full_name: string;
      guardians: { id: string; full_name: string; phone: string } | null;
    } | null;
    const guardian = patient?.guardians ?? null;
    const location = (appointment?.clinic_locations ?? null) as unknown as { type: string } | null;

    if (appointment && patient && guardian?.phone) {
      await sendAppointmentCancellation({
        supabase,
        appointmentId,
        guardianId: guardian.id,
        guardianPhone: guardian.phone,
        patientName: patient.full_name,
        scheduledAt: new Date(appointment.scheduled_at),
        locationLabel: location?.type === "clinic" ? "Consultório" : "Domiciliar",
      });
    }
  }

  return new Response(JSON.stringify({ ok: true }), {
    headers: { "Content-Type": "application/json" },
  });
};
