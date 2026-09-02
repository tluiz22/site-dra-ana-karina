import type { APIRoute } from "astro";
import { createClient } from "../../../../../../lib/supabase/server";
import { cancelEvent } from "../../../../../../lib/google/calendar";

export const POST: APIRoute = async ({ params, request, cookies }) => {
  const { id } = params;

  if (!id) {
    return new Response(JSON.stringify({ error: "id é obrigatório" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  await cancelEvent(id);

  const body = await request.json().catch(() => ({}));
  const appointmentId = typeof body?.appointmentId === "string" ? body.appointmentId : undefined;

  if (appointmentId) {
    const supabase = createClient(request, cookies);
    await supabase.from("appointments").update({ status: "canceled" }).eq("id", appointmentId);
  }

  return new Response(JSON.stringify({ ok: true }), {
    headers: { "Content-Type": "application/json" },
  });
};
