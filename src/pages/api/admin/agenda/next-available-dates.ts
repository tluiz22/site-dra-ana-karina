import type { APIRoute } from "astro";
import { createClient } from "../../../../lib/supabase/server";
import { getNextAvailableDates } from "../../../../lib/scheduling/getNextAvailableDates";

export const GET: APIRoute = async ({ url, request, cookies }) => {
  const clinicLocationId = url.searchParams.get("clinic_location_id");
  const appointmentType =
    url.searchParams.get("appointment_type") === "return_visit" ? "return_visit" : "first_visit";

  if (!clinicLocationId) {
    return new Response(JSON.stringify({ error: "clinic_location_id é obrigatório" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(request, cookies);
  const dates = await getNextAvailableDates({ supabase, clinicLocationId, appointmentType });

  return new Response(JSON.stringify({ dates }), { headers: { "Content-Type": "application/json" } });
};
