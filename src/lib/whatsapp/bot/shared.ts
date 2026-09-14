// Helpers compartilhados entre o webhook (`src/pages/api/whatsapp/webhook.ts`)
// e o roteador da máquina de estados (`./router.ts`).

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
    .update({ atendimento_humano: false, state: "MENU" })
    .eq("guardian_phone", guardianPhone);
  if (error) {
    console.error("[whatsapp bot] erro ao devolver conversa ao bot:", error.message);
  }
}
