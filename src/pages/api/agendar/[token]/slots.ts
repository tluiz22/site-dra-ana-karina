import type { APIRoute } from "astro";
import { createServiceClient } from "../../../../lib/supabase/service";
import { getAvailableSlotsForDate, type AppointmentType } from "../../../../lib/scheduling/getAvailableSlotsForDate";
import { getExamAvailableSlotsForDate } from "../../../../lib/scheduling/getExamAvailableSlotsForDate";
import { resolveClinicLocationIds, type LocationCategory } from "../../../../lib/scheduling/resolveClinicLocationIds";

export const GET: APIRoute = async ({ params, url }) => {
  const token = params.token;
  const date = url.searchParams.get("date");

  if (!token || !date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return new Response(JSON.stringify({ error: "date (YYYY-MM-DD) é obrigatório" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const supabase = createServiceClient();

  const { data: link } = await supabase
    .from("booking_links")
    .select(
      "clinic_location_id, location_category, appointment_type, exam_type_id, used_at, expires_at, exam_types ( duration_minutes, scheduling_mode )"
    )
    .eq("id", token)
    .maybeSingle();

  if (!link || link.used_at || new Date(link.expires_at) < new Date()) {
    return new Response(JSON.stringify({ error: "link inválido ou expirado" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  const examType = link.exam_types as unknown as { duration_minutes: number; scheduling_mode: string } | null;
  const appointmentType = link.appointment_type as AppointmentType;

  // Exame em grupo não usa esse endpoint (a página nem chama — o horário já
  // vem junto da data) — devolve vazio em vez de calcular horário errado
  // (individual) pra uma sessão de grupo.
  if (appointmentType === "exam" && examType?.scheduling_mode === "group") {
    return new Response(JSON.stringify({ slots: [] }), { headers: { "Content-Type": "application/json" } });
  }

  const slots =
    appointmentType === "exam"
      ? await getExamAvailableSlotsForDate({
          supabase,
          examTypeId: link.exam_type_id ?? "",
          examLocationId: link.clinic_location_id ?? "",
          date,
          examDurationMinutes: examType?.duration_minutes ?? 0,
        })
      : await getAvailableSlotsForDate({
          supabase,
          clinicLocationIds: await resolveClinicLocationIds(supabase, (link.location_category as LocationCategory) ?? "clinic"),
          date,
          appointmentType,
        });

  return new Response(
    JSON.stringify({
      slots: slots.map((slot) => ({
        start: slot.start.toISOString(),
        label: slot.label,
        clinicLocationId: slot.clinicLocationId,
      })),
    }),
    { headers: { "Content-Type": "application/json" } }
  );
};
