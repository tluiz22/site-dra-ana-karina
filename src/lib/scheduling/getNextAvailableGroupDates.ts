import type { SupabaseClient } from "@supabase/supabase-js";
import { isNationalHoliday } from "../holidays";

export interface AvailableGroupSession {
  date: string;
  weekday: number;
  startTime: string;
  endTime: string;
  capacity: number;
  remainingCapacity: number;
}

const DEFAULT_SESSION_COUNT = 10;
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
 * Datas com sessão disponível pra um exame em modo "grupo" (turma) — ao
 * contrário de `getNextAvailableDates`, não depende de freebusy do Google
 * Calendar: projeta os dias da semana cadastrados em
 * `exam_type_availability_windows`, pula feriados, e conta contra a
 * `capacity` de cada janela só os agendamentos não cancelados desse exame na
 * mesma data+hora exata (a sessão é um único horário fixo por dia da semana,
 * compartilhado por todos os pacientes daquele dia — não "1 horário = 1
 * paciente" como no modo individual).
 */
export async function getNextAvailableGroupDates({
  supabase,
  examTypeId,
  count = DEFAULT_SESSION_COUNT,
  maxDaysAhead = MAX_DAYS_AHEAD,
}: {
  supabase: SupabaseClient;
  examTypeId: string;
  count?: number;
  maxDaysAhead?: number;
}): Promise<AvailableGroupSession[]> {
  const { data: windows } = await supabase
    .from("exam_type_availability_windows")
    .select("weekday, start_time, end_time, capacity")
    .eq("exam_type_id", examTypeId)
    .eq("is_active", true)
    .order("start_time");

  if (!windows?.length) return [];

  const windowsByWeekday = new Map<number, typeof windows>();
  for (const window of windows) {
    const list = windowsByWeekday.get(window.weekday) ?? [];
    list.push(window);
    windowsByWeekday.set(window.weekday, list);
  }

  const startDate = todayFortaleza();
  const rangeStart = new Date(`${startDate}T00:00:00-03:00`);
  const rangeEnd = new Date(rangeStart.getTime() + maxDaysAhead * 24 * 60 * 60_000);

  // Uma única consulta pra todo o período (em vez de uma por dia candidato),
  // mesmo espírito de `getNextAvailableDates` com o freebusy do Calendar.
  const { data: existingAppointments } = await supabase
    .from("appointments")
    .select("scheduled_at")
    .eq("exam_type_id", examTypeId)
    .eq("appointment_type", "exam")
    .in("status", ["scheduled", "confirmed"])
    .gte("scheduled_at", rangeStart.toISOString())
    .lt("scheduled_at", rangeEnd.toISOString());

  const bookedCountByInstant = new Map<string, number>();
  for (const appointment of existingAppointments ?? []) {
    const instant = new Date(appointment.scheduled_at).toISOString();
    bookedCountByInstant.set(instant, (bookedCountByInstant.get(instant) ?? 0) + 1);
  }

  const results: AvailableGroupSession[] = [];
  let date = startDate;

  for (let offset = 0; offset < maxDaysAhead && results.length < count; offset++) {
    const weekday = new Date(`${date}T00:00:00-03:00`).getUTCDay();
    const windowsForDay = windowsByWeekday.get(weekday);

    if (windowsForDay && !isNationalHoliday(date)) {
      for (const window of windowsForDay) {
        const capacity = window.capacity ?? 0;
        if (capacity <= 0) continue;

        const sessionStart = new Date(`${date}T${window.start_time}-03:00`);
        if (sessionStart.getTime() <= Date.now()) continue;

        const booked = bookedCountByInstant.get(sessionStart.toISOString()) ?? 0;
        const remainingCapacity = capacity - booked;

        if (remainingCapacity > 0) {
          results.push({
            date,
            weekday,
            startTime: window.start_time.slice(0, 5),
            endTime: window.end_time.slice(0, 5),
            capacity,
            remainingCapacity,
          });
          if (results.length >= count) break;
        }
      }
    }

    date = addDays(date, 1);
  }

  return results;
}
