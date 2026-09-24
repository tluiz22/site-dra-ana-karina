import type { APIRoute } from "astro";
import { createClient } from "../../../../lib/supabase/server";
import { getExamNextAvailableDates } from "../../../../lib/scheduling/getExamNextAvailableDates";

export const GET: APIRoute = async ({ url, request, cookies }) => {
  const examTypeId = url.searchParams.get("exam_type_id");

  if (!examTypeId) {
    return new Response(JSON.stringify({ error: "exam_type_id é obrigatório" }), {
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
    return new Response(JSON.stringify({ dates: [] }), { headers: { "Content-Type": "application/json" } });
  }

  const dates = await getExamNextAvailableDates({
    supabase,
    examTypeId,
    examLocationId: examLocation.id,
    examDurationMinutes: examType.duration_minutes,
  });

  return new Response(JSON.stringify({ dates }), { headers: { "Content-Type": "application/json" } });
};
