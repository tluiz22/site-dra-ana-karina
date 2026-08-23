import type { APIRoute } from "astro";
import { createClient } from "../../../../../../../lib/supabase/server";

function isValidBirthdate(birthdate: string | undefined): birthdate is string {
  if (!birthdate || !/^\d{4}-\d{2}-\d{2}$/.test(birthdate)) return false;
  const today = new Date().toISOString().slice(0, 10);
  return birthdate >= "1900-01-01" && birthdate <= today;
}

export const POST: APIRoute = async ({ params, request, cookies, redirect }) => {
  const { id: guardianId, patientId } = params;
  const formData = await request.formData();
  const fullName = formData.get("full_name")?.toString().trim();
  const birthdate = formData.get("birthdate")?.toString();
  const notes = formData.get("notes")?.toString().trim() || null;

  if (!guardianId || !patientId || !fullName || !birthdate) {
    return redirect(`/admin/pacientes/${guardianId}?error=1`);
  }

  if (!isValidBirthdate(birthdate)) {
    return redirect(`/admin/pacientes/${guardianId}?error=invalid_birthdate`);
  }

  const supabase = createClient(request, cookies);
  const { error } = await supabase
    .from("patients")
    .update({ full_name: fullName, birthdate, notes })
    .eq("id", patientId)
    .eq("guardian_id", guardianId);

  if (error) {
    return redirect(`/admin/pacientes/${guardianId}?error=1`);
  }

  return redirect(`/admin/pacientes/${guardianId}`);
};
