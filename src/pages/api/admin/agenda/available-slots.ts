import type { APIRoute } from "astro";
import { createClient } from "../../../../lib/supabase/server";
import { getAvailableSlotsForDate } from "../../../../lib/scheduling/getAvailableSlotsForDate";

export const GET: APIRoute = async ({ url, request, cookies }) => {
  const clinicLocationId = url.searchParams.get("clinic_location_id");
  const date = url.searchParams.get("date");
  const appointmentType = url.searchParams.get("appointment_type") === "return_visit" ? "return_visit" : "first_visit";

  if (!clinicLocationId || !date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return new Response(
      JSON.stringify({ error: "clinic_location_id e date (YYYY-MM-DD) são obrigatórios" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const supabase = createClient(request, cookies);
  const slots = await getAvailableSlotsForDate({ supabase, clinicLocationId, date, appointmentType });

  return new Response(
    JSON.stringify({
      slots: slots.map((slot) => ({ start: slot.start.toISOString(), label: slot.label })),
    }),
    { headers: { "Content-Type": "application/json" } }
  );
};
