import type { APIRoute } from "astro";
import { createClient } from "../../../../../../lib/supabase/server";

// O retorno não tem valor próprio — está incluso no valor da consulta
// anterior (decisão do cliente) — por isso só o valor da consulta é
// editável por aqui.
export const POST: APIRoute = async ({ params, request, cookies, redirect }) => {
  const { id } = params;
  const formData = await request.formData();
  const priceFirstVisit = formData.get("price_first_visit")?.toString();

  const firstVisitCents = priceFirstVisit ? Math.round(Number(priceFirstVisit) * 100) : NaN;

  if (!id || !Number.isFinite(firstVisitCents)) {
    return redirect("/admin/configuracoes?error=1");
  }

  const supabase = createClient(request, cookies);
  const { error } = await supabase
    .from("clinic_locations")
    .update({ price_first_visit_cents: firstVisitCents })
    .eq("id", id);

  if (error) {
    return redirect("/admin/configuracoes?error=1");
  }

  return redirect("/admin/configuracoes");
};
