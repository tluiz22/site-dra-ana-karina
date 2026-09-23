// Resumo diário de consultas/exames para a equipe (Fase 7) — disparado pelo
// cron `daily-summary`, não por uma ação do responsável, então não está
// atrelado a um `appointment_id`/`guardian_id` específico (ambos ficam nulos
// em `whatsapp_messages`, já aceitos desde a migração 0003). Não reaproveita
// `sendNotification` (`notifications.ts`) — aquela é pensada para 1
// agendamento específico; aqui é uma lista de vários, montada pelo chamador.

import type { SupabaseClient } from "@supabase/supabase-js";
import { sendTemplateMessage } from "./client";

export async function sendDailySummaryMessage({
  supabase,
  to,
  templateName,
  messageType,
  listText,
}: {
  supabase: SupabaseClient;
  to: string; // E.164
  templateName: string | undefined;
  messageType: "daily_summary_consultas" | "daily_summary_exames";
  listText: string; // já formatado numa linha só (parâmetros de template não aceitam quebra de linha)
}): Promise<string> {
  const languageCode = (import.meta.env.WHATSAPP_TEMPLATE_LANGUAGE as string | undefined) ?? "pt_BR";

  let status: string;
  let waMessageId: string | null = null;

  if (!templateName) {
    status = "skipped_no_template";
    console.warn(`[whatsapp] template de ${messageType} não configurado — não enviado, apenas registrado.`);
  } else {
    try {
      const { id } = await sendTemplateMessage({
        to,
        templateName,
        languageCode,
        bodyParameters: [listText],
      });
      status = "sent";
      waMessageId = id;
      console.log(`[whatsapp] ${messageType} enviado (${id}) para ${to}`);
    } catch (err) {
      status = "failed";
      console.error(`[whatsapp] falha ao enviar ${messageType}:`, err instanceof Error ? err.message : String(err));
    }
  }

  const { error } = await supabase.from("whatsapp_messages").insert({
    appointment_id: null,
    guardian_id: null,
    direction: "outbound",
    message_type: messageType,
    template_name: templateName ?? null,
    body: listText,
    status,
    wa_message_id: waMessageId,
  });

  if (error) {
    console.error("[whatsapp] falha ao registrar whatsapp_messages:", error.message);
  }

  return status;
}
