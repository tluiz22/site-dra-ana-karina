import type { APIRoute } from "astro";
import { createClient } from "../../../../../lib/supabase/server";
import { normalizePhone } from "../../../../../lib/phone";

export const POST: APIRoute = async ({ params, request, cookies, redirect }) => {
  const { id } = params;
  const formData = await request.formData();
  const fullName = formData.get("full_name")?.toString().trim();
  const phoneRaw = formData.get("phone")?.toString().trim();

  if (!id || !fullName || !phoneRaw) {
    return redirect(`/admin/pacientes/${id}?error=1`);
  }

  const phone = normalizePhone(phoneRaw);

  if (!phone) {
    return redirect(`/admin/pacientes/${id}?error=invalid_phone`);
  }

  const supabase = createClient(request, cookies);
  const { error } = await supabase
    .from("guardians")
    .update({ full_name: fullName, phone })
    .eq("id", id);

  if (error) {
    return redirect(`/admin/pacientes/${id}?error=1`);
  }

  return redirect(`/admin/pacientes/${id}`);
};
