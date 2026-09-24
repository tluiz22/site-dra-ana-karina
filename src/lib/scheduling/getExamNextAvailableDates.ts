import type { SupabaseClient } from "@supabase/supabase-js";
import { queryFreeBusy } from "../google/calendar";
import { isNationalHoliday } from "../holidays";
import { computeAvailableSlots, type AvailabilityWindow } from "./slots";
import type { AvailableDate } from "./getNextAvailableDates";

const DEFAULT_DATE_COUNT = 10;
const MAX_DAYS_AHEAD = 60;

function todayFortaleza(): string {
  return new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function addDays(dateStr: string, delta: number): string {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

/**
 * Igual a `getNextAvailableDates`, mas pra exame individual: a disponibilidade
 * é a do próprio exame (`exam_type_availability_windows`), não a de um
 * `clinic_location_id` — cada exame tem seu próprio dia/horário cadastrado,
 * em vez de todos dividirem o horário do local genérico "Exames". Ainda
 * cruza com o freebusy do Google Calendar, igual à consulta/retorno.
 */
export async function getExamNextAvailableDates({
  supabase,
  examTypeId,
  examLocationId,
  examDurationMinutes,
  count = DEFAULT_DATE_COUNT,
  maxDaysAhead = MAX_DAYS_AHEAD,
}: {
  supabase: SupabaseClient;
  examTypeId: string;
  // Local físico único de todo exame — só carregado nos horários pra virar
  // o `clinicLocationId` do slot (Calendar/appointments), não afeta o
  // cálculo em si.
  examLocationId: string;
  examDurationMinutes: number;
  count?: number;
  maxDaysAhead?: number;
}): Promise<AvailableDate[]> {
  const [{ data: windows }, { data: settings }] = await Promise.all([
    supabase
      .from("exam_type_availability_windows")
      .select("weekday, start_time, end_time")
      .eq("exam_type_id", examTypeId)
      .eq("is_active", true)
      .order("start_time"),
    supabase.from("appointment_settings").select("*").eq("id", 1).single(),
  ]);

  if (!windows?.length || !settings) return [];

  const windowsByWeekday = new Map<number, AvailabilityWindow[]>();
  for (const window of windows) {
    const list = windowsByWeekday.get(window.weekday) ?? [];
    list.push({ ...window, clinic_location_id: examLocationId });
    windowsByWeekday.set(window.weekday, list);
  }

  const startDate = todayFortaleza();
  const rangeStart = new Date(`${startDate}T00:00:00-03:00`);
  const rangeEnd = new Date(rangeStart.getTime() + maxDaysAhead * 24 * 60 * 60_000);
  const busy = await queryFreeBusy(rangeStart, rangeEnd);

  const results: AvailableDate[] = [];
  let date = startDate;

  for (let offset = 0; offset < maxDaysAhead && results.length < count; offset++) {
    const weekday = new Date(`${date}T00:00:00-03:00`).getUTCDay();
    const windowsForDay = windowsByWeekday.get(weekday);

    if (windowsForDay && !isNationalHoliday(date)) {
      const slots = computeAvailableSlots({
        date,
        windows: windowsForDay,
        busy,
        appointmentType: "exam",
        firstVisitDurationMinutes: settings.default_appointment_duration_minutes,
        returnVisitDurationMinutes: settings.default_return_visit_duration_minutes,
        examDurationMinutes,
        bufferMinutes: settings.buffer_minutes_between_appointments,
      });

      if (slots.length > 0) results.push({ date, weekday });
    }

    date = addDays(date, 1);
  }

  return results;
}
