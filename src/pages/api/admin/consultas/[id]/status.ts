import type { APIRoute } from "astro";
import { createClient } from "../../../../../lib/supabase/server";

export const POST: APIRoute = async ({ params, request, cookies, redirect }) => {
  const { id } = params;
  const formData = await request.formData();
  const status = formData.get("status")?.toString();
  const tab = formData.get("tab")?.toString() === "confirmadas" ? "confirmadas" : "pendentes";
  const page = formData.get("page")?.toString();
  const pageParam = tab === "confirmadas" && page ? `&page=${page}` : "";

  if (!id || (status !== "completed" && status !== "no_show")) {
    return redirect(`/admin/consultas?tab=${tab}${pageParam}&error=1`);
  }

  const supabase = createClient(request, cookies);
  const { error } = await supabase.from("appointments").update({ status }).eq("id", id);

  if (error) {
    return redirect(`/admin/consultas?tab=${tab}${pageParam}&error=1`);
  }

  return redirect(`/admin/consultas?tab=${tab}${pageParam}`);
};
