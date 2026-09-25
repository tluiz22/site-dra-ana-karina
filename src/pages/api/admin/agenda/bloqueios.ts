import type { APIRoute } from "astro";
import { createBlockEvent } from "../../../../lib/google/calendar";

// Fase 13 etapa 1: cria um bloqueio simples no Google Calendar, sem checar
// conflito com atendimentos existentes no período ainda (isso é a etapa 2).
export const POST: APIRoute = async ({ request, redirect }) => {
  const formData = await request.formData();
  const startDate = formData.get("start_date")?.toString();
  const startTime = formData.get("start_time")?.toString();
  const endDate = formData.get("end_date")?.toString();
  const endTime = formData.get("end_time")?.toString();
  const motivo = formData.get("motivo")?.toString().trim();

  const back = (error: string) => redirect(`/admin/agenda/bloquear?error=${error}`);

  if (!startDate || !startTime || !endDate || !endTime || !motivo) {
    return back("1");
  }

  const startIso = `${startDate}T${startTime}:00-03:00`;
  const endIso = `${endDate}T${endTime}:00-03:00`;
  const start = new Date(startIso);
  const end = new Date(endIso);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
    return back("invalid_range");
  }

  await createBlockEvent({ description: motivo, start: start.toISOString(), end: end.toISOString() });

  return redirect(`/admin/agenda?date=${startDate}`);
};
