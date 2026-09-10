import crypto from "node:crypto";
import type { APIRoute } from "astro";
import type { SupabaseClient } from "@supabase/supabase-js";
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

// POST: eventos da Meta Cloud API. Trata três coisas, todas registradas em
// `whatsapp_messages`:
//   - `messages`        → mensagem recebida do paciente (inbound);
//   - `statuses`        → status de entrega das mensagens que enviamos;
//   - `message_echoes`  → mensagens que a secretária enviou pelo app do
//                         WhatsApp Business (coexistência — campo
//                         `smb_message_echoes`).
// A máquina de estados do bot (Fase 3b) entra depois; aqui só há registro.
export const POST: APIRoute = async ({ request }) => {
  const appSecret = import.meta.env.WHATSAPP_APP_SECRET;
  if (!appSecret) {
    console.error("[whatsapp webhook] WHATSAPP_APP_SECRET não configurada — POST recusado.");
    return new Response("webhook não configurado", { status: 500 });
  }

  // A Meta assina o corpo cru (HMAC-SHA256, hex) no header
  // X-Hub-Signature-256: "sha256=<hex>". Comparação em tempo constante.
  const rawBody = await request.text();
  if (!isValidSignature(appSecret, rawBody, request.headers.get("x-hub-signature-256"))) {
    return new Response("assinatura inválida", { status: 401 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let payload: any;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new Response(null, { status: 200 });
  }

  const changes: WebhookChangeValue[] =
    payload?.entry?.flatMap((entry: { changes?: { value?: WebhookChangeValue }[] }) =>
      (entry?.changes ?? []).map((c) => c?.value).filter(Boolean)
    ) ?? [];

  if (changes.length === 0) {
    return new Response(null, { status: 200 });
  }

  const supabase = createServiceClient();

  for (const value of changes) {
    for (const msg of value.messages ?? []) {
      await handleInboundMessage(supabase, msg);
    }
    for (const status of value.statuses ?? []) {
      await handleDeliveryStatus(supabase, status);
    }
    for (const echo of value.message_echoes ?? []) {
      await handleAgentEcho(supabase, echo);
    }
  }

  // A Meta exige resposta 200 rápida, senão considera falha e reenvia o evento.
  return new Response(null, { status: 200 });
};

// --- tipos mínimos do payload -------------------------------------------

interface WaMessage {
  id?: string;
  from?: string;
  to?: string;
  type?: string;
  text?: { body?: string };
  button?: { text?: string };
  interactive?: {
    list_reply?: { id?: string; title?: string };
    button_reply?: { id?: string; title?: string };
  };
}

interface WaStatus {
  id?: string;
  status?: string;
  recipient_id?: string;
  errors?: { code?: number; title?: string; message?: string }[];
}

interface WebhookChangeValue {
  messages?: WaMessage[];
  statuses?: WaStatus[];
  message_echoes?: WaMessage[];
}

// --- helpers ------------------------------------------------------------

// Confere o header X-Hub-Signature-256 ("sha256=<hex>") contra o HMAC-SHA256
// do corpo cru com o App Secret. Comparação em tempo constante.
function isValidSignature(appSecret: string, rawBody: string, header: string | null): boolean {
  if (!header?.startsWith("sha256=")) return false;

  const expected = crypto.createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex");
  const expectedBuf = Buffer.from(expected, "hex");
  const receivedBuf = Buffer.from(header.slice("sha256=".length), "hex");

  return (
    expectedBuf.length === receivedBuf.length &&
    crypto.timingSafeEqual(expectedBuf, receivedBuf)
  );
}

// "5584981880777" (formato da Meta) → "+5584981880777".
function toE164(waFrom: string | undefined): string | null {
  return waFrom && /^\d{10,15}$/.test(waFrom) ? `+${waFrom}` : null;
}

// Texto legível de uma mensagem recebida ou de um echo.
function extractBody(msg: WaMessage): string | null {
  if (msg.text?.body) return msg.text.body;
  if (msg.interactive?.list_reply) {
    return msg.interactive.list_reply.title ?? msg.interactive.list_reply.id ?? null;
  }
  if (msg.interactive?.button_reply) {
    return msg.interactive.button_reply.title ?? msg.interactive.button_reply.id ?? null;
  }
  if (msg.button?.text) return msg.button.text;
  return msg.type ? `[${msg.type}]` : null;
}

async function resolveGuardianId(
  supabase: SupabaseClient,
  phoneE164: string
): Promise<string | null> {
  const { data } = await supabase
    .from("guardians")
    .select("id")
    .eq("phone", phoneE164)
    .eq("is_active", true)
    .maybeSingle();
  return data?.id ?? null;
}

// Ordem dos status de entrega — evita regredir se a Meta entregar os
// webhooks fora de ordem (ex.: "read" chegando antes de "delivered").
const DELIVERY_STATUS_RANK: Record<string, number> = {
  sent: 1,
  delivered: 2,
  read: 3,
  failed: 3,
};

// --- handlers ---------------------------------------------------------

async function handleInboundMessage(supabase: SupabaseClient, msg: WaMessage): Promise<void> {
  const phone = toE164(msg.from);
  if (!phone) return;

  console.log("[whatsapp webhook] inbound:", JSON.stringify(msg));

  const { error: csError } = await supabase
    .from("conversation_state")
    .upsert({ guardian_phone: phone }, { onConflict: "guardian_phone", ignoreDuplicates: true });
  if (csError) {
    console.error("[whatsapp webhook] erro ao gravar conversation_state:", csError.message);
  }

  const guardianId = await resolveGuardianId(supabase, phone);

  const { error } = await supabase.from("whatsapp_messages").upsert(
    {
      wa_message_id: msg.id ?? null,
      guardian_id: guardianId,
      direction: "inbound",
      message_type: msg.type ?? "unknown",
      body: extractBody(msg),
      status: "received",
    },
    { onConflict: "wa_message_id", ignoreDuplicates: true }
  );
  if (error) {
    console.error("[whatsapp webhook] erro ao registrar inbound:", error.message);
  }
}

async function handleDeliveryStatus(supabase: SupabaseClient, status: WaStatus): Promise<void> {
  const waId = status.id;
  const newStatus = status.status;
  if (!waId || !newStatus) return;

  const { data: row } = await supabase
    .from("whatsapp_messages")
    .select("id, status")
    .eq("wa_message_id", waId)
    .maybeSingle();

  // Status de uma mensagem que não é nossa, ou que ainda não foi gravada.
  if (!row) return;

  const currentRank = DELIVERY_STATUS_RANK[row.status ?? ""] ?? 0;
  const newRank = DELIVERY_STATUS_RANK[newStatus] ?? 0;
  if (newRank < currentRank) return;

  if (newStatus === "failed" && status.errors?.length) {
    console.error(
      `[whatsapp webhook] entrega falhou (${waId}):`,
      status.errors.map((e) => `${e.code} ${e.title ?? e.message}`).join("; ")
    );
  }

  const { error } = await supabase
    .from("whatsapp_messages")
    .update({ status: newStatus })
    .eq("id", row.id);
  if (error) {
    console.error("[whatsapp webhook] erro ao atualizar status:", error.message);
  }
}

async function handleAgentEcho(supabase: SupabaseClient, echo: WaMessage): Promise<void> {
  console.log("[whatsapp webhook] echo (secretária pelo app):", JSON.stringify(echo));

  const recipient = toE164(echo.to);
  const guardianId = recipient ? await resolveGuardianId(supabase, recipient) : null;

  const { error } = await supabase.from("whatsapp_messages").upsert(
    {
      wa_message_id: echo.id ?? null,
      guardian_id: guardianId,
      direction: "outbound",
      message_type: "agent_reply",
      body: extractBody(echo),
      status: "sent",
    },
    { onConflict: "wa_message_id", ignoreDuplicates: true }
  );
  if (error) {
    console.error("[whatsapp webhook] erro ao registrar echo:", error.message);
  }
}
