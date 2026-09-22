import type { APIRoute } from "astro";
import { createClient } from "../../../../lib/supabase/server";
import { getAvailableSlotsForDate } from "../../../../lib/scheduling/getAvailableSlotsForDate";
import { resolveClinicLocationIds, type LocationCategory } from "../../../../lib/scheduling/resolveClinicLocationIds";

export const GET: APIRoute = async ({ url, request, cookies }) => {
  const locationCategoryParam = url.searchParams.get("location_category");
  const date = url.searchParams.get("date");
  const appointmentType = url.searchParams.get("appointment_type") === "return_visit" ? "return_visit" : "first_visit";

  if (!locationCategoryParam || !date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return new Response(
      JSON.stringify({ error: "location_category e date (YYYY-MM-DD) são obrigatórios" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const locationCategory: LocationCategory = locationCategoryParam === "home_visit" ? "home_visit" : "clinic";
  const supabase = createClient(request, cookies);
  const clinicLocationIds = await resolveClinicLocationIds(supabase, locationCategory);
  const slots = await getAvailableSlotsForDate({ supabase, clinicLocationIds, date, appointmentType });

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
