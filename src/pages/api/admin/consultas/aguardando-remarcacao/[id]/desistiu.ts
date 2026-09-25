import type { APIRoute } from "astro";
import { createClient } from "../../../../../../lib/supabase/server";

// Marca que a equipe não vai mais acompanhar esse cancelamento (ex.: o
// responsável avisou que desistiu da consulta) — tira o paciente da aba
// "Aguardando remarcação" sem apagar o histórico do atendimento.
export const POST: APIRoute = async ({ params, request, cookies, redirect }) => {
  const { id } = params;

  if (id) {
    const supabase = createClient(request, cookies);
    await supabase.from("appointments").update({ rebooking_dismissed_at: new Date().toISOString() }).eq("id", id);
  }

  return redirect("/admin/consultas?tab=aguardando_remarcacao");
};
