import type { APIRoute } from "astro";
import { createClient } from "../../../../../lib/supabase/server";
import { normalizePhone } from "../../../../../lib/phone";

export const POST: APIRoute = async ({ params, request, cookies, redirect }) => {
  const { id } = params;
  const formData = await request.formData();
  const label = formData.get("label")?.toString().trim();
  const phone = normalizePhone(formData.get("phone")?.toString() ?? "");
  const receivesConsultas = formData.get("receives_consultas") === "on";
  const receivesExames = formData.get("receives_exames") === "on";

  if (!id) {
    return redirect("/admin/configuracoes/contatos?error=1");
  }

  if (!label || !phone) {
    return redirect(`/admin/configuracoes/contatos/${id}?error=1`);
  }

  const supabase = createClient(request, cookies);
  const { error } = await supabase
    .from("notification_recipients")
    .update({
      label,
      phone,
      receives_consultas: receivesConsultas,
      receives_exames: receivesExames,
    })
    .eq("id", id);

  if (error) {
    return redirect(`/admin/configuracoes/contatos/${id}?error=1`);
  }

  return redirect("/admin/configuracoes/contatos");
};
