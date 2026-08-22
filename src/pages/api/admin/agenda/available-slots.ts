import type { APIRoute } from "astro";
import { createClient } from "../../../../lib/supabase/server";
import { queryFreeBusy } from "../../../../lib/google/calendar";
import { computeAvailableSlots } from "../../../../lib/scheduling/slots";

export const GET: APIRoute = async ({ url, request, cookies }) => {
  const clinicLocationId = url.searchParams.get("clinic_location_id");
  const date = url.searchParams.get("date");

  if (!clinicLocationId || !date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return new Response(
      JSON.stringify({ error: "clinic_location_id e date (YYYY-MM-DD) são obrigatórios" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const supabase = createClient(request, cookies);
  const weekday = new Date(`${date}T00:00:00-03:00`).getUTCDay();

  const [{ data: windows }, { data: settings }] = await Promise.all([
    supabase
      .from("availability_windows")
      .select("start_time, end_time")
      .eq("clinic_location_id", clinicLocationId)
      .eq("weekday", weekday)
      .eq("is_active", true)
      .order("start_time"),
    supabase.from("appointment_settings").select("*").eq("id", 1).single(),
  ]);

  if (!windows?.length || !settings) {
    return new Response(JSON.stringify({ slots: [] }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  const dayStart = new Date(`${date}T00:00:00-03:00`);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60_000);
  const busy = await queryFreeBusy(dayStart, dayEnd);

  const slots = computeAvailableSlots({
    date,
    windows,
    busy,
    durationMinutes: settings.default_appointment_duration_minutes,
    bufferMinutes: settings.buffer_minutes_between_appointments,
  });

  return new Response(
    JSON.stringify({
      slots: slots.map((slot) => ({ start: slot.start.toISOString(), label: slot.label })),
    }),
    { headers: { "Content-Type": "application/json" } }
  );
};
