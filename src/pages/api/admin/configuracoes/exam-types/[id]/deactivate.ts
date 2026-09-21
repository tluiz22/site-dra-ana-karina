import type { APIRoute } from "astro";
import { createClient } from "../../../../../../lib/supabase/server";

// Exclusão lógica (is_active=false), não hard delete — appointments.exam_type_id
// referencia essa tabela, então um exame já marcado no passado não pode
// perder a referência.
export const POST: APIRoute = async ({ params, request, cookies, redirect }) => {
  const { id } = params;

  if (!id) {
    return redirect("/admin/configuracoes/exames?error=1");
  }

  const supabase = createClient(request, cookies);
  const { error } = await supabase.from("exam_types").update({ is_active: false }).eq("id", id);

  if (error) {
    return redirect("/admin/configuracoes/exames?error=1");
  }

  return redirect("/admin/configuracoes/exames");
};
