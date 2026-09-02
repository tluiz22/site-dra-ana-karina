import type { APIRoute } from "astro";
import { createClient } from "../../../../../../lib/supabase/server";
import { rescheduleEvent } from "../../../../../../lib/google/calendar";
import { getAvailableSlotsForDate, type AppointmentType } from "../../../../../../lib/scheduling/getAvailableSlotsForDate";

export const POST: APIRoute = async ({ params, request, cookies, redirect }) => {
  const { id } = params;
  const formData = await request.formData();
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
      `/admin/agenda/remarcar?appointment_id=${id}&clinic_location_id=${clinicLocationId ?? ""}&date=${date ?? ""}&appointment_type=${appointmentType ?? "first_visit"}&error=${error}`
    );

  if (!id || !clinicLocationId || !date || !start || !appointmentType) {
    return back("1");
  }

  const supabase = createClient(request, cookies);

  const { data: appointment } = await supabase
    .from("appointments")
    .select("id, google_event_id, status")
    .eq("id", id)
    .single();

  if (!appointment || !appointment.google_event_id || !["scheduled", "confirmed"].includes(appointment.status)) {
    return back("1");
  }

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

  await supabase
    .from("appointments")
    .update({
      clinic_location_id: clinicLocationId,
      scheduled_at: startDate.toISOString(),
      duration_minutes: durationMinutes,
      appointment_type: appointmentType,
    })
    .eq("id", id);

  await rescheduleEvent(appointment.google_event_id, {
    start: startDate.toISOString(),
    end: endDate.toISOString(),
  });

  return redirect(`/admin/agenda?date=${date}`);
};
