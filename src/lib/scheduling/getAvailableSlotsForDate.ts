import type { SupabaseClient } from "@supabase/supabase-js";
import { queryFreeBusy } from "../google/calendar";
import { isNationalHoliday } from "../holidays";
import { computeAvailableSlots, type AppointmentType, type AvailableSlot } from "./slots";

export type { AppointmentType };

export async function getAvailableSlotsForDate({
  supabase,
  clinicLocationIds,
  date,
  appointmentType,
  examDurationMinutes,
}: {
  supabase: SupabaseClient;
  // Um ou mais `clinic_location_id` (mais de um consultório físico type=
  // 'clinic' são mesclados — ver resolveClinicLocationIds.ts).
  clinicLocationIds: string[];
  date: string;
  appointmentType: AppointmentType;
  examDurationMinutes?: number;
}): Promise<AvailableSlot[]> {
  // Nunca oferece horário em feriado nacional — nem sugerido, nem escolhido
  // manualmente (ex.: admin tentando marcar direto numa data de feriado).
  if (isNationalHoliday(date)) return [];
  if (clinicLocationIds.length === 0) return [];

  const weekday = new Date(`${date}T00:00:00-03:00`).getUTCDay();

  const [{ data: windows }, { data: settings }] = await Promise.all([
    supabase
      .from("availability_windows")
      .select("clinic_location_id, start_time, end_time")
      .in("clinic_location_id", clinicLocationIds)
      .eq("weekday", weekday)
      .eq("is_active", true)
      .order("start_time"),
    supabase.from("appointment_settings").select("*").eq("id", 1).single(),
  ]);

  if (!windows?.length || !settings) return [];

  const dayStart = new Date(`${date}T00:00:00-03:00`);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60_000);
  const busy = await queryFreeBusy(dayStart, dayEnd);

  return computeAvailableSlots({
    date,
    windows,
    busy,
    appointmentType,
    firstVisitDurationMinutes: settings.default_appointment_duration_minutes,
    returnVisitDurationMinutes: settings.default_return_visit_duration_minutes,
    examDurationMinutes,
    bufferMinutes: settings.buffer_minutes_between_appointments,
  });
}
