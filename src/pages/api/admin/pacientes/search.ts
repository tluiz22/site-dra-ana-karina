import type { APIRoute } from "astro";
import { createClient } from "../../../../lib/supabase/server";

export const GET: APIRoute = async ({ url, request, cookies }) => {
  const q = url.searchParams.get("q")?.trim() ?? "";

  if (q.length < 2) {
    return new Response(JSON.stringify([]), { headers: { "Content-Type": "application/json" } });
  }

  const supabase = createClient(request, cookies);
  const isPhoneLike = /\d{4,}/.test(q);

  const selectColumns =
    "id, full_name, birthdate, guardians ( full_name, phone ), appointments ( status, scheduled_at )";

  const query = isPhoneLike
    ? supabase
        .from("patients")
        .select(selectColumns.replace("guardians (", "guardians!inner ("))
        .eq("is_active", true)
        .ilike("guardians.phone", `%${q}%`)
        .limit(10)
    : supabase
        .from("patients")
        .select(selectColumns)
        .eq("is_active", true)
        .ilike("full_name", `%${q}%`)
        .limit(10);

  const { data } = await query;
  const now = new Date().toISOString();

  const results = (data ?? []).map((patient: any) => ({
    id: patient.id,
    full_name: patient.full_name,
    birthdate: patient.birthdate,
    guardian_name: patient.guardians?.full_name ?? "",
    guardian_phone: patient.guardians?.phone ?? "",
    has_upcoming_appointment: (patient.appointments ?? []).some(
      (appointment: { status: string; scheduled_at: string }) =>
        ["scheduled", "confirmed"].includes(appointment.status) && appointment.scheduled_at > now
    ),
  }));

  return new Response(JSON.stringify(results), { headers: { "Content-Type": "application/json" } });
};
