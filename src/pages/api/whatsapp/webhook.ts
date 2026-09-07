import type { APIRoute } from "astro";
import { createServiceClient } from "../../../lib/supabase/service";

// GET: handshake de verificação exigido pela Meta ao cadastrar a URL do
// webhook no painel do App (WhatsApp > Configuração > Webhooks).
export const GET: APIRoute = async ({ url }) => {
  const mode = url.searchParams.get("hub.mode");
  const verifyToken = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  if (mode === "subscribe" && verifyToken === import.meta.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN) {
    return new Response(challenge, { status: 200 });
  }

  return new Response("Forbidden", { status: 403 });
};

// POST: recebe eventos de mensagem da Meta Cloud API. Por enquanto só
// registra a mensagem recebida no log do servidor — a máquina de estados
// (Fase 3b) entra numa etapa seguinte, quando o número de teste estiver
// liberado.
export const POST: APIRoute = async ({ request }) => {
  const payload = await request.json();

  const message = payload?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
  if (!message) {
    console.log("[whatsapp webhook] payload sem mensagem (provável status update):", JSON.stringify(payload));
    return new Response(null, { status: 200 });
  }

  console.log("[whatsapp webhook] mensagem recebida:", JSON.stringify(message));

  // "from" da Meta já vem em E.164 sem o "+" (ex.: "5584981880777") —
  // diferente do normalizePhone usado no admin, que assume número local
  // brasileiro sem DDI e prefixa +55.
  const phone = /^\d{10,15}$/.test(message.from) ? `+${message.from}` : null;

  if (phone) {
    const supabase = createServiceClient();
    const { error } = await supabase
      .from("conversation_state")
      .upsert({ guardian_phone: phone }, { onConflict: "guardian_phone", ignoreDuplicates: true });

    if (error) {
      console.error("[whatsapp webhook] erro ao gravar conversation_state:", error.message);
    }
  }

  // A Meta exige resposta 200 rápida, senão considera falha e reenvia o evento.
  return new Response(null, { status: 200 });
};
