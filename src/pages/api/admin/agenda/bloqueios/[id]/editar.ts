import type { APIRoute } from "astro";
import { rescheduleEvent, updateEventDetails } from "../../../../../../lib/google/calendar";

function addDaysStr(dateStr: string, delta: number): string {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

// Fase 13 etapa 3: edita data/hora e motivo de um bloqueio já criado — sem
// checar conflito com atendimentos de novo (só a criação faz essa
// pergunta, ver bloqueios.ts).
export const POST: APIRoute = async ({ params, request, redirect }) => {
  const { id } = params;
  const formData = await request.formData();
  const startDate = formData.get("start_date")?.toString();
  const endDate = formData.get("end_date")?.toString();
  const motivo = formData.get("motivo")?.toString().trim();
  const isFullDay = formData.get("full_day") != null;
  const startTime = isFullDay ? "00:00" : formData.get("start_time")?.toString();
  const endTime = isFullDay ? "00:00" : formData.get("end_time")?.toString();
  const effectiveEndDate = isFullDay && endDate ? addDaysStr(endDate, 1) : endDate;

  const back = (error: string) => redirect(`/admin/agenda/bloqueios/${id}/editar?error=${error}`);

  if (!id || !startDate || !startTime || !effectiveEndDate || !endTime || !motivo) {
    return back("1");
  }

  const start = new Date(`${startDate}T${startTime}:00-03:00`);
  const end = new Date(`${effectiveEndDate}T${endTime}:00-03:00`);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
    return back("invalid_range");
  }

  await rescheduleEvent(id, { start: start.toISOString(), end: end.toISOString() });
  await updateEventDetails(id, { summary: "Bloqueio administrativo", description: motivo });

  return redirect("/admin/agenda/bloqueios");
};
