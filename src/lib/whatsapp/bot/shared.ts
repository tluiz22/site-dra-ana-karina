// Helpers compartilhados entre o webhook (`src/pages/api/whatsapp/webhook.ts`)
// e os módulos da máquina de estados (`./router.ts`, `./booking.ts`, ...).

import type { SupabaseClient } from "@supabase/supabase-js";

// "5584981880777" (formato da Meta) → "+5584981880777".
export function toE164(waFrom: string | undefined): string | null {
  return waFrom && /^\d{10,15}$/.test(waFrom) ? `+${waFrom}` : null;
}

export async function resolveGuardianId(
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

// Devolve a conversa ao bot: a palavra-chave `#bot` enviada pela secretária
// pelo app do WhatsApp Business (detectada no echo `smb_message_echoes`)
// desliga `atendimento_humano` e volta o estado para MENU — ver "Coexistência"
// e "Máquina de estados" no plano (Fase 3b).
export async function returnControlToBot(
  supabase: SupabaseClient,
  guardianPhone: string
): Promise<void> {
  const { error } = await supabase
    .from("conversation_state")
    .update({ atendimento_humano: false, state: "MENU", context: {} })
    .eq("guardian_phone", guardianPhone);
  if (error) {
    console.error("[whatsapp bot] erro ao devolver conversa ao bot:", error.message);
  }
}

// Base pública do site, para montar o link de `/agendar/[token]` enviado
// pelo bot. Mesma lógica de fallback do `astro.config.mjs` (site institucional
// em produção, preview da Vercel, ou localhost em dev) — só que resolvida em
// runtime, já que o webhook roda como função de servidor.
export function resolveSiteUrl(): string {
  const explicit = import.meta.env.SITE_URL as string | undefined;
  if (explicit) return explicit.replace(/\/$/, "");

  const vercelEnv = import.meta.env.VERCEL_ENV as string | undefined;
  if (vercelEnv === "production") return "https://draanakarinapneumo.com.br";

  const vercelUrl = import.meta.env.VERCEL_URL as string | undefined;
  if (vercelUrl) return `https://${vercelUrl}`;

  return "http://localhost:4321";
}

// --- resposta do usuário (toque em lista ou texto digitado) ---------------

export interface Selection {
  id: string | null;
  text: string;
}

export function extractSelection(waMsg: {
  text?: { body?: string };
  interactive?: {
    list_reply?: { id?: string; title?: string };
    button_reply?: { id?: string; title?: string };
  };
  button?: { text?: string };
}): Selection {
  const id = waMsg.interactive?.list_reply?.id ?? waMsg.interactive?.button_reply?.id ?? null;
  const text = (
    waMsg.text?.body ??
    waMsg.interactive?.list_reply?.title ??
    waMsg.interactive?.button_reply?.title ??
    waMsg.button?.text ??
    ""
  ).trim();
  return { id, text };
}

// Aceita tanto o toque na lista interativa (`selection.id`) quanto o
// paciente digitando o número diretamente (ex.: "1" ou "1. Agendar").
export function matchesOption(selection: Selection, digit: string, listId: string): boolean {
  if (selection.id === listId) return true;
  const normalized = selection.text.toLowerCase();
  return normalized === digit || normalized.startsWith(`${digit}.`) || normalized.startsWith(`${digit} `);
}

// --- estado da conversa -----------------------------------------------

export async function updateConversationState(
  supabase: SupabaseClient,
  guardianPhone: string,
  state: string,
  extra: Record<string, unknown> = {}
): Promise<void> {
  const { error } = await supabase
    .from("conversation_state")
    .update({ state, ...extra })
    .eq("guardian_phone", guardianPhone);
  if (error) {
    console.error("[whatsapp bot] erro ao atualizar conversation_state:", error.message);
  }
}

// --- envio + log ---------------------------------------------------------

export async function sendAndLog(
  supabase: SupabaseClient,
  guardianId: string | null,
  messageType: string,
  bodyForLog: string,
  send: () => Promise<{ id: string }>
): Promise<void> {
  try {
    const { id } = await send();
    await logOutbound(supabase, guardianId, messageType, bodyForLog, id, "sent");
  } catch (err) {
    console.error(
      `[whatsapp bot] falha ao enviar ${messageType}:`,
      err instanceof Error ? err.message : String(err)
    );
    await logOutbound(supabase, guardianId, messageType, bodyForLog, null, "failed");
  }
}

async function logOutbound(
  supabase: SupabaseClient,
  guardianId: string | null,
  messageType: string,
  body: string,
  waMessageId: string | null,
  status: string
): Promise<void> {
  const { error } = await supabase.from("whatsapp_messages").insert({
    guardian_id: guardianId,
    direction: "outbound",
    message_type: messageType,
    body,
    status,
    wa_message_id: waMessageId,
  });
  if (error) {
    console.error("[whatsapp bot] erro ao registrar mensagem de saída:", error.message);
  }
}
