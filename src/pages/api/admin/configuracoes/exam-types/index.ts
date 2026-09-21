import type { APIRoute } from "astro";
import { createClient } from "../../../../../lib/supabase/server";

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const formData = await request.formData();
  const name = formData.get("name")?.toString().trim();
  const durationMinutes = Number(formData.get("duration_minutes"));
  const price = formData.get("price")?.toString();
  const preparationInstructions = formData.get("preparation_instructions")?.toString().trim() || null;

  const priceCents = price ? Math.round(Number(price) * 100) : NaN;

  if (!name || !Number.isFinite(durationMinutes) || durationMinutes < 1 || !Number.isFinite(priceCents)) {
    return redirect("/admin/configuracoes/exames?error=1");
  }

  const supabase = createClient(request, cookies);
  const { error } = await supabase.from("exam_types").insert({
    name,
    duration_minutes: durationMinutes,
    price_cents: priceCents,
    preparation_instructions: preparationInstructions,
  });

  if (error) {
    return redirect("/admin/configuracoes/exames?error=1");
  }

  return redirect("/admin/configuracoes/exames");
};
