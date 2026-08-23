import type { APIRoute } from "astro";
import { createClient } from "../../../../../../../lib/supabase/server";

export const POST: APIRoute = async ({ params, request, cookies, redirect }) => {
  const { id: guardianId, patientId } = params;

  if (!guardianId || !patientId) {
    return redirect(`/admin/pacientes/${guardianId}?error=1`);
  }

  const supabase = createClient(request, cookies);
  const { error } = await supabase
    .from("patients")
    .update({ is_active: false })
    .eq("id", patientId)
    .eq("guardian_id", guardianId);

  if (error) {
    return redirect(`/admin/pacientes/${guardianId}?error=1`);
  }

  return redirect(`/admin/pacientes/${guardianId}`);
};
