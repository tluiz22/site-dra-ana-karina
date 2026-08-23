import type { APIRoute } from "astro";
import { createClient } from "../../../../lib/supabase/server";
import { normalizePhone } from "../../../../lib/phone";

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const formData = await request.formData();
  const guardianFullName = formData.get("guardian_full_name")?.toString().trim();
  const guardianPhoneRaw = formData.get("guardian_phone")?.toString().trim();
  const patientFullName = formData.get("patient_full_name")?.toString().trim();
  const patientBirthdate = formData.get("patient_birthdate")?.toString();
  const patientNotes = formData.get("patient_notes")?.toString().trim() || null;

  if (!guardianFullName || !guardianPhoneRaw || !patientFullName || !patientBirthdate) {
    return redirect("/admin/pacientes?error=1");
  }

  const guardianPhone = normalizePhone(guardianPhoneRaw);

  if (!guardianPhone) {
    return redirect("/admin/pacientes?error=invalid_phone");
  }

  const today = new Date().toISOString().slice(0, 10);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(patientBirthdate) ||
    patientBirthdate < "1900-01-01" ||
    patientBirthdate > today
  ) {
    return redirect("/admin/pacientes?error=invalid_birthdate");
  }

  const supabase = createClient(request, cookies);

  const { data: existingGuardian, error: guardianFetchError } = await supabase
    .from("guardians")
    .select("id, is_active")
    .eq("phone", guardianPhone)
    .maybeSingle();

  if (guardianFetchError) {
    return redirect("/admin/pacientes?error=1");
  }

  let guardianId = existingGuardian?.id;

  if (!guardianId) {
    const { data: newGuardian, error: guardianInsertError } = await supabase
      .from("guardians")
      .insert({ full_name: guardianFullName, phone: guardianPhone })
      .select("id")
      .single();

    if (guardianInsertError || !newGuardian) {
      return redirect("/admin/pacientes?error=1");
    }

    guardianId = newGuardian.id;
  } else if (existingGuardian && !existingGuardian.is_active) {
    // Telefone reaproveitado de um responsável excluído logicamente — reativa em vez de bloquear.
    const { error: reactivateError } = await supabase
      .from("guardians")
      .update({ is_active: true })
      .eq("id", guardianId);

    if (reactivateError) {
      return redirect("/admin/pacientes?error=1");
    }
  }

  const { error: patientInsertError } = await supabase.from("patients").insert({
    guardian_id: guardianId,
    full_name: patientFullName,
    birthdate: patientBirthdate,
    notes: patientNotes,
  });

  if (patientInsertError) {
    return redirect("/admin/pacientes?error=1");
  }

  return redirect("/admin/pacientes");
};
