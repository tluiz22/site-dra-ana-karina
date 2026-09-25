import type { APIRoute } from "astro";
import { createBlockEvent } from "../../../../lib/google/calendar";

function addDaysStr(dateStr: string, delta: number): string {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

// Fase 13 etapa 1: cria um bloqueio simples no Google Calendar, sem checar
// conflito com atendimentos existentes no período ainda (isso é a etapa 2).
export const POST: APIRoute = async ({ request, redirect }) => {
  const formData = await request.formData();
  const startDate = formData.get("start_date")?.toString();
  const endDate = formData.get("end_date")?.toString();
  const motivo = formData.get("motivo")?.toString().trim();
  // "Dia todo": não pede hora — cobre de 00h da data de início até 00h do
  // dia seguinte à data de fim (fim exclusivo, cobre o dia de fim inteiro).
  const isFullDay = formData.get("full_day") != null;
  const startTime = isFullDay ? "00:00" : formData.get("start_time")?.toString();
  const endTime = isFullDay ? "00:00" : formData.get("end_time")?.toString();
  const effectiveEndDate = isFullDay && endDate ? addDaysStr(endDate, 1) : endDate;

  const back = (error: string) => redirect(`/admin/agenda/bloquear?error=${error}`);

  if (!startDate || !startTime || !effectiveEndDate || !endTime || !motivo) {
    return back("1");
  }

  const startIso = `${startDate}T${startTime}:00-03:00`;
  const endIso = `${effectiveEndDate}T${endTime}:00-03:00`;
  const start = new Date(startIso);
  const end = new Date(endIso);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
    return back("invalid_range");
  }

  await createBlockEvent({ description: motivo, start: start.toISOString(), end: end.toISOString() });

  return redirect(`/admin/agenda?date=${startDate}`);
};
