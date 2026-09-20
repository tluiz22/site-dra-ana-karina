import type { SupabaseClient } from "@supabase/supabase-js";
import { queryFreeBusy } from "../google/calendar";
import { isNationalHoliday } from "../holidays";
import { computeAvailableSlots, type AppointmentType, type AvailabilityWindow } from "./slots";

export interface AvailableDate {
  date: string;
  weekday: number;
}

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
 * Varre os próximos dias a partir de hoje e retorna as primeiras `count` datas com pelo menos
 * um horário livre para o local/tipo de consulta informados (usadas no passo BOOK_DATE_SELECT
 * do bot de WhatsApp e reutilizáveis pela tela de admin). Faz uma única consulta de freeBusy
 * cobrindo toda a janela de busca, em vez de uma por dia, para não multiplicar chamadas à API
 * do Google Calendar.
 */
export async function getNextAvailableDates({
  supabase,
  clinicLocationId,
  appointmentType,
  count = DEFAULT_DATE_COUNT,
  maxDaysAhead = MAX_DAYS_AHEAD,
}: {
  supabase: SupabaseClient;
  clinicLocationId: string;
  appointmentType: AppointmentType;
  count?: number;
  maxDaysAhead?: number;
}): Promise<AvailableDate[]> {
  const [{ data: windows }, { data: settings }] = await Promise.all([
    supabase
      .from("availability_windows")
      .select("weekday, start_time, end_time")
      .eq("clinic_location_id", clinicLocationId)
      .eq("is_active", true)
      .order("start_time"),
    supabase.from("appointment_settings").select("*").eq("id", 1).single(),
  ]);

  if (!windows?.length || !settings) return [];

  const windowsByWeekday = new Map<number, AvailabilityWindow[]>();
  for (const window of windows) {
    const list = windowsByWeekday.get(window.weekday) ?? [];
    list.push(window);
    windowsByWeekday.set(window.weekday, list);
  }
  if (!windowsByWeekday.size) return [];

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
        appointmentType,
        firstVisitDurationMinutes: settings.default_appointment_duration_minutes,
        returnVisitDurationMinutes: settings.default_return_visit_duration_minutes,
        bufferMinutes: settings.buffer_minutes_between_appointments,
      });

      if (slots.length > 0) results.push({ date, weekday });
    }

    date = addDays(date, 1);
  }

  return results;
}
