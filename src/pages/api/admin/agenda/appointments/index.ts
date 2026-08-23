import type { APIRoute } from "astro";
import { createClient } from "../../../../../lib/supabase/server";
import { createEvent } from "../../../../../lib/google/calendar";
import { getAvailableSlotsForDate, type AppointmentType } from "../../../../../lib/scheduling/getAvailableSlotsForDate";

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const formData = await request.formData();
  const patientId = formData.get("patient_id")?.toString();
  const clinicLocationId = formData.get("clinic_location_id")?.toString();
  const date = formData.get("date")?.toString();
  const appointmentTypeRaw = formData.get("appointment_type")?.toString();
  const start = formData.get("start")?.toString();

  const appointmentType: AppointmentType | null =
    appointmentTypeRaw === "first_visit" || appointmentTypeRaw === "return_visit"
      ? appointmentTypeRaw
      : null;

  const back = (error: string) =>
    redirect(
      `/admin/agenda/marcar?clinic_location_id=${clinicLocationId ?? ""}&date=${date ?? ""}&appointment_type=${appointmentType ?? "first_visit"}&error=${error}`
    );

  if (!patientId || !clinicLocationId || !date || !start || !appointmentType) {
    return back("1");
  }

  const supabase = createClient(request, cookies);

  const [{ data: settings }, slots] = await Promise.all([
    supabase.from("appointment_settings").select("*").eq("id", 1).single(),
    getAvailableSlotsForDate({ supabase, clinicLocationId, date, appointmentType }),
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

  const { data: patient } = await supabase
    .from("patients")
    .select("full_name, guardians ( full_name, phone )")
    .eq("id", patientId)
    .single();

  if (!patient) {
    return back("1");
  }

  const { data: existingFutureAppointment } = await supabase
    .from("appointments")
    .select("id")
    .eq("patient_id", patientId)
    .in("status", ["scheduled", "confirmed"])
    .gt("scheduled_at", new Date().toISOString())
    .limit(1)
    .maybeSingle();

  if (existingFutureAppointment) {
    return back("patient_already_scheduled");
  }

  const { data: location } = await supabase
    .from("clinic_locations")
    .select("type")
    .eq("id", clinicLocationId)
    .single();

  const { data: newAppointment, error: insertError } = await supabase
    .from("appointments")
    .insert({
      patient_id: patientId,
      clinic_location_id: clinicLocationId,
      scheduled_at: startDate.toISOString(),
      duration_minutes: durationMinutes,
      appointment_type: appointmentType,
      status: "scheduled",
      booking_channel: "admin",
    })
    .select("id")
    .single();

  if (insertError || !newAppointment) {
    return back("1");
  }

  const guardian = (patient.guardians ?? null) as unknown as { full_name: string; phone: string } | null;

  const event = await createEvent({
    summary: `Consulta — ${patient.full_name}${guardian ? ` (resp. ${guardian.full_name})` : ""}`,
    description: `Tel: ${guardian?.phone ?? "—"} | Tipo: ${appointmentType === "return_visit" ? "Retorno" : "Primeira consulta"} | Local: ${location?.type === "clinic" ? "Consultório" : "Domiciliar"}`,
    start: startDate.toISOString(),
    end: endDate.toISOString(),
    appointmentId: newAppointment.id,
  });

  await supabase.from("appointments").update({ google_event_id: event.id }).eq("id", newAppointment.id);

  return redirect(`/admin/agenda?date=${date}`);
};
