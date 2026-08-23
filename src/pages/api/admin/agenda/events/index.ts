import type { APIRoute } from "astro";
import { createEvent } from "../../../../../lib/google/calendar";

export const POST: APIRoute = async ({ request }) => {
  const body = await request.json();
  const { summary, description, start, end, appointment_id } = body;

  if (!summary || !start || !end || !appointment_id) {
    return new Response(
      JSON.stringify({ error: "summary, start, end e appointment_id são obrigatórios" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const event = await createEvent({
    summary,
    description: description ?? "",
    start,
    end,
    appointmentId: appointment_id,
  });

  return new Response(JSON.stringify(event), {
    status: 201,
    headers: { "Content-Type": "application/json" },
  });
};
