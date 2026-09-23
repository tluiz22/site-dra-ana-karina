import type { APIRoute } from "astro";
import { createClient } from "../../../../../../lib/supabase/server";

export const POST: APIRoute = async ({ params, request, cookies, redirect }) => {
  const { id } = params;

  if (!id) {
    return redirect("/admin/configuracoes/exames?error=1");
  }

  const supabase = createClient(request, cookies);
  const { error } = await supabase.from("exam_types").update({ is_active: true }).eq("id", id);

  if (error) {
    return redirect("/admin/configuracoes/exames?error=1");
  }

  return redirect("/admin/configuracoes/exames?show_inactive=1");
};
