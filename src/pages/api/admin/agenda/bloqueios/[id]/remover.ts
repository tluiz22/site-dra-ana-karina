import type { APIRoute } from "astro";
import { cancelEvent } from "../../../../../../lib/google/calendar";

// Fase 13 etapa 3: remove um bloqueio (cancela o evento no Calendar — mesmo
// verbo já usado pro cancelamento de consulta/exame).
export const POST: APIRoute = async ({ params, redirect }) => {
  const { id } = params;
  if (id) {
    await cancelEvent(id);
  }
  return redirect("/admin/agenda/bloqueios");
};
