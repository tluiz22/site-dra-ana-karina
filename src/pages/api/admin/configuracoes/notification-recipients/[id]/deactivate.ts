import type { APIRoute } from "astro";
import { createClient } from "../../../../../../lib/supabase/server";

// Exclusão lógica — permite reativar depois (ex.: número de teste que volta
// a ser usado num novo período), sem perder o cadastro.
export const POST: APIRoute = async ({ params, request, cookies, redirect }) => {
  const { id } = params;

  if (!id) {
    return redirect("/admin/configuracoes/contatos?error=1");
  }

  const supabase = createClient(request, cookies);
  const { error } = await supabase.from("notification_recipients").update({ is_active: false }).eq("id", id);

  if (error) {
    return redirect("/admin/configuracoes/contatos?error=1");
  }

  return redirect("/admin/configuracoes/contatos");
};
