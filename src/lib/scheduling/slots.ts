export interface AvailabilityWindow {
  start_time: string;
  end_time: string;
}

export interface BusyInterval {
  start: string;
  end: string;
}

export interface AvailableSlot {
  start: Date;
  label: string;
}

function timeToMinutes(time: string): number {
  const [hours, minutes] = time.slice(0, 5).split(":").map(Number);
  return hours * 60 + minutes;
}

function formatMinutes(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60) % 24;
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

interface MinuteInterval {
  start: number;
  end: number;
}

function mergeBusyIntervals(busy: BusyInterval[], dayStart: number, bufferMinutes: number): MinuteInterval[] {
  const intervals = busy
    .map((interval) => ({
      start: (new Date(interval.start).getTime() - dayStart) / 60_000 - bufferMinutes,
      end: (new Date(interval.end).getTime() - dayStart) / 60_000 + bufferMinutes,
    }))
    .sort((a, b) => a.start - b.start);

  const merged: MinuteInterval[] = [];
  for (const interval of intervals) {
    const last = merged[merged.length - 1];
    if (last && interval.start <= last.end) {
      last.end = Math.max(last.end, interval.end);
    } else {
      merged.push({ ...interval });
    }
  }

  return merged;
}

export type AppointmentType = "first_visit" | "return_visit";

interface MinuteGap {
  start: number;
  end: number;
}

/** No máximo 4 sugestões para consulta de retorno, para não afogar a secretária de opções. */
const MAX_RETURN_VISIT_SUGGESTIONS = 4;

export function computeAvailableSlots({
  date,
  windows,
  busy,
  appointmentType,
  firstVisitDurationMinutes,
  returnVisitDurationMinutes,
  bufferMinutes,
}: {
  date: string;
  windows: AvailabilityWindow[];
  busy: BusyInterval[];
  appointmentType: AppointmentType;
  firstVisitDurationMinutes: number;
  returnVisitDurationMinutes: number;
  bufferMinutes: number;
}): AvailableSlot[] {
  const dayStart = new Date(`${date}T00:00:00-03:00`).getTime();
  const mergedBusy = mergeBusyIntervals(busy, dayStart, bufferMinutes);

  function slotsFromGap(gap: MinuteGap, durationMinutes: number): AvailableSlot[] {
    const result: AvailableSlot[] = [];
    for (
      let slotStartMinutes = gap.start;
      slotStartMinutes + durationMinutes <= gap.end;
      slotStartMinutes += durationMinutes
    ) {
      const slotStart = dayStart + slotStartMinutes * 60_000;
      if (slotStart > Date.now()) {
        result.push({ start: new Date(slotStart), label: formatMinutes(slotStartMinutes) });
      }
    }
    return result;
  }

  // Intervalos livres dentro das janelas de atendimento, já descontando o que está ocupado (+ buffer).
  const gaps: MinuteGap[] = [];
  for (const window of windows) {
    const windowStartMinutes = timeToMinutes(window.start_time);
    const windowEndMinutes = timeToMinutes(window.end_time);

    let cursor = windowStartMinutes;
    for (const busyInterval of mergedBusy) {
      const gapEnd = Math.min(busyInterval.start, windowEndMinutes);
      if (gapEnd > cursor) gaps.push({ start: cursor, end: gapEnd });
      cursor = Math.max(cursor, Math.min(busyInterval.end, windowEndMinutes));
      if (cursor >= windowEndMinutes) break;
    }
    if (cursor < windowEndMinutes) gaps.push({ start: cursor, end: windowEndMinutes });
  }

  if (appointmentType === "first_visit") {
    // Cada intervalo livre é preenchido a partir do próprio início (não do início da janela),
    // para que uma consulta mais curta não deixe um buraco impossível de preencher por uma mais longa.
    return gaps.flatMap((gap) => slotsFromGap(gap, firstVisitDurationMinutes));
  }

  // Retorno: prioriza buracos que nunca caberiam uma primeira consulta (não faz diferença
  // usá-los para retorno) e só depois oferece a sobra de buracos grandes o suficiente para
  // uma primeira consulta — reservando mentalmente o início do buraco para ela, sem fragmentar
  // um bloco que pode ser precisado inteiro por uma consulta maior.
  const prioritySlots: AvailableSlot[] = [];
  const leftoverSlots: AvailableSlot[] = [];

  for (const gap of gaps) {
    const gapDuration = gap.end - gap.start;
    if (gapDuration < firstVisitDurationMinutes) {
      prioritySlots.push(...slotsFromGap(gap, returnVisitDurationMinutes));
    } else {
      const leftover: MinuteGap = { start: gap.start + firstVisitDurationMinutes, end: gap.end };
      leftoverSlots.push(...slotsFromGap(leftover, returnVisitDurationMinutes));
    }
  }

  return [...prioritySlots, ...leftoverSlots].slice(0, MAX_RETURN_VISIT_SUGGESTIONS);
}
