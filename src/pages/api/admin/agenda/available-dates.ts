import type { APIRoute } from "astro";
import { createClient } from "../../../../lib/supabase/server";
import { getNextAvailableDates } from "../../../../lib/scheduling/getNextAvailableDates";
import { resolveClinicLocationIds, type LocationCategory } from "../../../../lib/scheduling/resolveClinicLocationIds";

export const GET: APIRoute = async ({ url, request, cookies }) => {
  const locationCategoryParam = url.searchParams.get("location_category");
  const appointmentType = url.searchParams.get("appointment_type") === "return_visit" ? "return_visit" : "first_visit";

  if (!locationCategoryParam) {
    return new Response(JSON.stringify({ error: "location_category é obrigatório" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const locationCategory: LocationCategory = locationCategoryParam === "home_visit" ? "home_visit" : "clinic";
  const supabase = createClient(request, cookies);
  const clinicLocationIds = await resolveClinicLocationIds(supabase, locationCategory);
  const dates = await getNextAvailableDates({ supabase, clinicLocationIds, appointmentType });

  return new Response(JSON.stringify({ dates }), { headers: { "Content-Type": "application/json" } });
};
