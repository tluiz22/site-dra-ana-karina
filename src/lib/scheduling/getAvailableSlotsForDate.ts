import type { SupabaseClient } from "@supabase/supabase-js";
import { queryFreeBusy } from "../google/calendar";
import { computeAvailableSlots, type AvailableSlot } from "./slots";

export type AppointmentType = "first_visit" | "return_visit";

export async function getAvailableSlotsForDate({
  supabase,
  clinicLocationId,
  date,
  appointmentType,
}: {
  supabase: SupabaseClient;
  clinicLocationId: string;
  date: string;
  appointmentType: AppointmentType;
}): Promise<AvailableSlot[]> {
  const weekday = new Date(`${date}T00:00:00-03:00`).getUTCDay();

  const [{ data: windows }, { data: settings }] = await Promise.all([
    supabase
      .from("availability_windows")
      .select("start_time, end_time")
      .eq("clinic_location_id", clinicLocationId)
      .eq("weekday", weekday)
      .eq("is_active", true)
      .order("start_time"),
    supabase.from("appointment_settings").select("*").eq("id", 1).single(),
  ]);

  if (!windows?.length || !settings) return [];

  const durationMinutes =
    appointmentType === "return_visit"
      ? settings.default_return_visit_duration_minutes
      : settings.default_appointment_duration_minutes;

  const dayStart = new Date(`${date}T00:00:00-03:00`);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60_000);
  const busy = await queryFreeBusy(dayStart, dayEnd);

  return computeAvailableSlots({
    date,
    windows,
    busy,
    durationMinutes,
    bufferMinutes: settings.buffer_minutes_between_appointments,
  });
}
