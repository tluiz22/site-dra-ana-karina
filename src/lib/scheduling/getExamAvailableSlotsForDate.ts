import type { SupabaseClient } from "@supabase/supabase-js";
import { queryFreeBusy } from "../google/calendar";
import { isNationalHoliday } from "../holidays";
import { computeAvailableSlots, type AvailableSlot } from "./slots";

/**
 * Igual a `getAvailableSlotsForDate`, mas pra exame individual: a
 * disponibilidade é a do próprio exame (`exam_type_availability_windows`),
 * não a de um `clinic_location_id` — ver `getExamNextAvailableDates` pro
 * mesmo raciocínio aplicado à busca de datas.
 */
export async function getExamAvailableSlotsForDate({
  supabase,
  examTypeId,
  examLocationId,
  date,
  examDurationMinutes,
}: {
  supabase: SupabaseClient;
  examTypeId: string;
  examLocationId: string;
  date: string;
  examDurationMinutes: number;
}): Promise<AvailableSlot[]> {
  // Nunca oferece horário em feriado nacional — nem sugerido, nem escolhido
  // manualmente (ex.: admin tentando marcar direto numa data de feriado).
  if (isNationalHoliday(date)) return [];

  const weekday = new Date(`${date}T00:00:00-03:00`).getUTCDay();

  const [{ data: windows }, { data: settings }] = await Promise.all([
    supabase
      .from("exam_type_availability_windows")
      .select("start_time, end_time")
      .eq("exam_type_id", examTypeId)
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
    windows: windows.map((window) => ({ ...window, clinic_location_id: examLocationId })),
    busy,
    appointmentType: "exam",
    firstVisitDurationMinutes: settings.default_appointment_duration_minutes,
    returnVisitDurationMinutes: settings.default_return_visit_duration_minutes,
    examDurationMinutes,
    bufferMinutes: settings.buffer_minutes_between_appointments,
  });
}
