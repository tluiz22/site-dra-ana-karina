import type { APIRoute } from "astro";
import { createClient } from "../../../../../lib/supabase/server";

export const POST: APIRoute = async ({ params, request, cookies, redirect }) => {
  const { id } = params;

  if (!id) {
    return redirect("/admin/pacientes?error=1");
  }

  const supabase = createClient(request, cookies);
  const { error } = await supabase.from("guardians").update({ is_active: false }).eq("id", id);

  if (error) {
    return redirect("/admin/pacientes?error=1");
  }

  return redirect("/admin/pacientes");
};
