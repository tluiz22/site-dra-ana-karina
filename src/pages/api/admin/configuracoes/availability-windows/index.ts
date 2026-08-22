import type { APIRoute } from "astro";
import { createClient } from "../../../../../lib/supabase/server";

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const formData = await request.formData();
  const clinicLocationId = formData.get("clinic_location_id")?.toString();
  const weekday = formData.get("weekday")?.toString();
  const startTime = formData.get("start_time")?.toString();
  const endTime = formData.get("end_time")?.toString();

  if (!clinicLocationId || !weekday || !startTime || !endTime) {
    return redirect("/admin/configuracoes?error=1");
  }

  if (startTime >= endTime) {
    return redirect("/admin/configuracoes?error=invalid_range");
  }

  const supabase = createClient(request, cookies);

  const { data: existingWindows, error: fetchError } = await supabase
    .from("availability_windows")
    .select("start_time, end_time")
    .eq("clinic_location_id", clinicLocationId)
    .eq("weekday", Number(weekday));

  if (fetchError) {
    return redirect("/admin/configuracoes?error=1");
  }

  const overlaps = existingWindows?.some((window) => {
    const existingStart = window.start_time.slice(0, 5);
    const existingEnd = window.end_time.slice(0, 5);
    return startTime < existingEnd && endTime > existingStart;
  });

  if (overlaps) {
    return redirect("/admin/configuracoes?error=overlap");
  }

  const { error } = await supabase.from("availability_windows").insert({
    clinic_location_id: clinicLocationId,
    weekday: Number(weekday),
    start_time: startTime,
    end_time: endTime,
  });

  if (error) {
    return redirect("/admin/configuracoes?error=1");
  }

  return redirect("/admin/configuracoes");
};
