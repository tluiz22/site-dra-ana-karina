import type { APIRoute } from "astro";
import { createServiceClient } from "../../../../lib/supabase/service";
import { createEvent, rescheduleEvent } from "../../../../lib/google/calendar";
import { getAvailableSlotsForDate, type AppointmentType } from "../../../../lib/scheduling/getAvailableSlotsForDate";
import { sendAppointmentConfirmation, sendAppointmentReschedule } from "../../../../lib/whatsapp/notifications";

export const POST: APIRoute = async ({ params, request, redirect }) => {
  const token = params.token;
  const formData = await request.formData();
  const date = formData.get("date")?.toString();
  const start = formData.get("start")?.toString();

  const back = (error: string) => redirect(`/agendar/${token}?date=${date ?? ""}&error=${error}`);

  if (!token || !date || !start) {
    return back("1");
  }

  const supabase = createServiceClient();

  const { data: link } = await supabase.from("booking_links").select("*").eq("id", token).maybeSingle();

  // Link inexistente, já usado ou expirado: manda de volta para a página,
  // que mostra o estado certo (usado = confirmação, expirado/inválido = aviso).
  if (!link || link.used_at || new Date(link.expires_at) < new Date()) {
    return redirect(`/agendar/${token}`);
  }

  const appointmentType = link.appointment_type as AppointmentType;

  const [{ data: settings }, slots] = await Promise.all([
    supabase.from("appointment_settings").select("*").eq("id", 1).single(),
    getAvailableSlotsForDate({ supabase, clinicLocationId: link.clinic_location_id, date, appointmentType }),
  ]);

  if (!settings) {
    return back("1");
  }

  const matchedSlot = slots.find((slot) => slot.start.toISOString() === start);
  if (!matchedSlot) {
    return back("slot_taken");
  }

  const durationMinutes =
    appointmentType === "return_visit"
      ? settings.default_return_visit_duration_minutes
      : settings.default_appointment_duration_minutes;

  const startDate = matchedSlot.start;
  const endDate = new Date(startDate.getTime() + durationMinutes * 60_000);

  const [{ data: patient }, { data: location }] = await Promise.all([
    supabase
      .from("patients")
      .select("full_name, guardians ( id, full_name, phone )")
      .eq("id", link.patient_id)
      .single(),
    supabase
      .from("clinic_locations")
      .select("type, address, price_first_visit_cents")
      .eq("id", link.clinic_location_id)
      .single(),
  ]);

  if (!patient) {
    return back("1");
  }

  const guardian = (patient.guardians ?? null) as unknown as {
    id: string;
    full_name: string;
    phone: string;
  } | null;
  const locationLabel = location?.type === "clinic" ? "Consultório" : "Domiciliar";
  const locationAddress = location?.address ?? null;
  // Retorno não tem valor próprio — está incluso no valor da consulta
  // anterior (decisão do cliente); `null` aciona esse texto na notificação.
  const priceCents = appointmentType === "return_visit" ? null : location?.price_first_visit_cents;

  let appointmentId: string;

  if (link.mode === "reschedule") {
    const { data: appointment } = await supabase
      .from("appointments")
      .select("id, google_event_id, status")
      .eq("id", link.appointment_id)
      .single();

    if (!appointment || !appointment.google_event_id || !["scheduled", "confirmed"].includes(appointment.status)) {
      return back("1");
    }

    await supabase
      .from("appointments")
      .update({
        clinic_location_id: link.clinic_location_id,
        scheduled_at: startDate.toISOString(),
        duration_minutes: durationMinutes,
        appointment_type: appointmentType,
      })
      .eq("id", appointment.id);

    await rescheduleEvent(appointment.google_event_id, {
      start: startDate.toISOString(),
      end: endDate.toISOString(),
    });

    appointmentId = appointment.id;

    if (guardian?.phone) {
      await sendAppointmentReschedule({
        supabase,
        appointmentId,
        guardianId: guardian.id,
        guardianPhone: guardian.phone,
        patientName: patient.full_name,
        scheduledAt: startDate,
        locationLabel,
        locationAddress,
      });
    }
  } else {
    // Mesma trava do admin: bloqueia um segundo agendamento futuro ativo
    // para o mesmo paciente.
    const { data: existingFutureAppointment } = await supabase
      .from("appointments")
      .select("id")
      .eq("patient_id", link.patient_id)
      .in("status", ["scheduled", "confirmed"])
      .gt("scheduled_at", new Date().toISOString())
      .limit(1)
      .maybeSingle();

    if (existingFutureAppointment) {
      return back("1");
    }

    const { data: newAppointment, error: insertError } = await supabase
      .from("appointments")
      .insert({
        patient_id: link.patient_id,
        clinic_location_id: link.clinic_location_id,
        scheduled_at: startDate.toISOString(),
        duration_minutes: durationMinutes,
        appointment_type: appointmentType,
        status: "scheduled",
        booking_channel: "whatsapp_bot",
      })
      .select("id")
      .single();

    if (insertError || !newAppointment) {
      return back("1");
    }

    const event = await createEvent({
      summary: `Consulta — ${patient.full_name}${guardian ? ` (resp. ${guardian.full_name})` : ""}`,
      description: `Tel: ${guardian?.phone ?? "—"} | Tipo: ${appointmentType === "return_visit" ? "Retorno" : "Consulta"} | Local: ${locationLabel}`,
      start: startDate.toISOString(),
      end: endDate.toISOString(),
      appointmentId: newAppointment.id,
    });

    await supabase.from("appointments").update({ google_event_id: event.id }).eq("id", newAppointment.id);

    appointmentId = newAppointment.id;

    if (guardian?.phone) {
      await sendAppointmentConfirmation({
        supabase,
        appointmentId,
        guardianId: guardian.id,
        guardianPhone: guardian.phone,
        patientName: patient.full_name,
        scheduledAt: startDate,
        locationLabel,
        locationAddress,
        priceCents,
      });
    }
  }

  // Uso único: marca o link como usado e guarda a consulta gerada, para a
  // página mostrar a confirmação mesmo se o link for reaberto depois.
  await supabase
    .from("booking_links")
    .update({ used_at: new Date().toISOString(), appointment_id: appointmentId })
    .eq("id", token);

  return redirect(`/agendar/${token}`);
};
