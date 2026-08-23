import type { APIRoute } from "astro";
import { rescheduleEvent } from "../../../../../../lib/google/calendar";

export const POST: APIRoute = async ({ params, request }) => {
  const { id } = params;
  const body = await request.json();
  const { start, end } = body;

  if (!id || !start || !end) {
    return new Response(JSON.stringify({ error: "id, start e end são obrigatórios" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  await rescheduleEvent(id, { start, end });

  return new Response(JSON.stringify({ ok: true }), {
    headers: { "Content-Type": "application/json" },
  });
};
