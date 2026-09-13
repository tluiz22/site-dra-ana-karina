import type { APIRoute } from "astro";
import { createServiceClient } from "../../../../lib/supabase/service";
import { getAvailableSlotsForDate, type AppointmentType } from "../../../../lib/scheduling/getAvailableSlotsForDate";

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
    .select("clinic_location_id, appointment_type, used_at, expires_at")
    .eq("id", token)
    .maybeSingle();

  if (!link || link.used_at || new Date(link.expires_at) < new Date()) {
    return new Response(JSON.stringify({ error: "link inválido ou expirado" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  const slots = await getAvailableSlotsForDate({
    supabase,
    clinicLocationId: link.clinic_location_id,
    date,
    appointmentType: link.appointment_type as AppointmentType,
  });

  return new Response(
    JSON.stringify({ slots: slots.map((slot) => ({ start: slot.start.toISOString(), label: slot.label })) }),
    { headers: { "Content-Type": "application/json" } }
  );
};
