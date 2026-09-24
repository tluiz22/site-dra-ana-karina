import type { APIRoute } from "astro";
import { createClient } from "../../../../lib/supabase/server";
import { getNextAvailableGroupDates } from "../../../../lib/scheduling/getNextAvailableGroupDates";

export const GET: APIRoute = async ({ url, request, cookies }) => {
  const examTypeId = url.searchParams.get("exam_type_id");

  if (!examTypeId) {
    return new Response(JSON.stringify({ error: "exam_type_id é obrigatório" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(request, cookies);
  const sessions = await getNextAvailableGroupDates({ supabase, examTypeId });

  return new Response(JSON.stringify({ sessions }), { headers: { "Content-Type": "application/json" } });
};
