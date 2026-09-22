import type { APIRoute } from "astro";
import { createClient } from "../../../../lib/supabase/server";
import { getAvailableSlotsForDate } from "../../../../lib/scheduling/getAvailableSlotsForDate";

export const GET: APIRoute = async ({ url, request, cookies }) => {
  const examTypeId = url.searchParams.get("exam_type_id");
  const date = url.searchParams.get("date");

  if (!examTypeId || !date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return new Response(JSON.stringify({ error: "exam_type_id e date (YYYY-MM-DD) são obrigatórios" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(request, cookies);

  const [{ data: examLocation }, { data: examType }] = await Promise.all([
    supabase.from("clinic_locations").select("id").eq("type", "exam").eq("is_active", true).maybeSingle(),
    supabase.from("exam_types").select("duration_minutes").eq("id", examTypeId).maybeSingle(),
  ]);

  if (!examLocation || !examType) {
    return new Response(JSON.stringify({ slots: [] }), { headers: { "Content-Type": "application/json" } });
  }

  const slots = await getAvailableSlotsForDate({
    supabase,
    clinicLocationIds: [examLocation.id],
    date,
    appointmentType: "exam",
    examDurationMinutes: examType.duration_minutes,
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
