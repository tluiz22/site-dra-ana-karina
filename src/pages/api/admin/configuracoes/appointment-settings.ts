import type { APIRoute } from "astro";
import { createClient } from "../../../../lib/supabase/server";

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const formData = await request.formData();
  const defaultAppointmentDuration = formData
    .get("default_appointment_duration_minutes")
    ?.toString();
  const defaultReturnVisitDuration = formData
    .get("default_return_visit_duration_minutes")
    ?.toString();
  const bufferMinutes = formData.get("buffer_minutes_between_appointments")?.toString();

  if (!defaultAppointmentDuration || !defaultReturnVisitDuration || !bufferMinutes) {
    return redirect("/admin/configuracoes?error=1");
  }

  const supabase = createClient(request, cookies);
  const { error } = await supabase
    .from("appointment_settings")
    .update({
      default_appointment_duration_minutes: Number(defaultAppointmentDuration),
      default_return_visit_duration_minutes: Number(defaultReturnVisitDuration),
      buffer_minutes_between_appointments: Number(bufferMinutes),
      updated_at: new Date().toISOString(),
    })
    .eq("id", 1);

  if (error) {
    return redirect("/admin/configuracoes?error=1");
  }

  return redirect("/admin/configuracoes");
};
