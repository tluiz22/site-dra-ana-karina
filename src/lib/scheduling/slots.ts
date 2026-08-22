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

export function computeAvailableSlots({
  date,
  windows,
  busy,
  durationMinutes,
  bufferMinutes,
}: {
  date: string;
  windows: AvailabilityWindow[];
  busy: BusyInterval[];
  durationMinutes: number;
  bufferMinutes: number;
}): AvailableSlot[] {
  const dayStart = new Date(`${date}T00:00:00-03:00`).getTime();
  const slots: AvailableSlot[] = [];

  for (const window of windows) {
    const windowStartMinutes = timeToMinutes(window.start_time);
    const windowEndMinutes = timeToMinutes(window.end_time);

    for (
      let slotStartMinutes = windowStartMinutes;
      slotStartMinutes + durationMinutes <= windowEndMinutes;
      slotStartMinutes += durationMinutes
    ) {
      const slotStart = dayStart + slotStartMinutes * 60_000;
      const slotEnd = dayStart + (slotStartMinutes + durationMinutes) * 60_000;

      const isFree = !busy.some((interval) => {
        const busyStart = new Date(interval.start).getTime() - bufferMinutes * 60_000;
        const busyEnd = new Date(interval.end).getTime() + bufferMinutes * 60_000;
        return slotStart < busyEnd && slotEnd > busyStart;
      });

      if (isFree) {
        slots.push({ start: new Date(slotStart), label: formatMinutes(slotStartMinutes) });
      }
    }
  }

  return slots;
}
