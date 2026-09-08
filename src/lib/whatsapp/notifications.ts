// Notificações de agendamento por WhatsApp (Fase 3a).
//
// Camada acima do cliente de baixo nível (`./client`): monta os parâmetros
// do template aprovado na Meta, dispara o envio e registra a mensagem em
// `whatsapp_messages`. Uma falha no envio NUNCA deve derrubar a marcação
// que originou a notificação — o chamador trata isto como "melhor esforço".

import type { SupabaseClient } from "@supabase/supabase-js";
import { sendTemplateMessage } from "./client";

const TIMEZONE = "America/Fortaleza";

// Formato: "21/08/2026 às 14h00" (fuso do consultório, não do servidor).
function formatWhen(date: Date): string {
  const datePart = new Intl.DateTimeFormat("pt-BR", {
    timeZone: TIMEZONE,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);

  const timePart = new Intl.DateTimeFormat("pt-BR", {
    timeZone: TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
    .format(date)
    .replace(":", "h");

  return `${datePart} às ${timePart}`;
}

interface AppointmentConfirmationInput {
  supabase: SupabaseClient;
  appointmentId: string;
  guardianId: string;
  guardianPhone: string; // E.164, ex.: "+5584981880777"
  patientName: string;
  scheduledAt: Date;
  locationLabel: string; // "Consultório" | "Domiciliar"
}

// Dispara a confirmação de consulta recém-marcada e grava o log.
// Retorna o status registrado (útil para teste/depuração); não lança.
export async function sendAppointmentConfirmation({
  supabase,
  appointmentId,
  guardianId,
  guardianPhone,
  patientName,
  scheduledAt,
  locationLabel,
}: AppointmentConfirmationInput): Promise<string> {
  const templateName = import.meta.env.WHATSAPP_TEMPLATE_CONFIRMATION as string | undefined;
  const languageCode = (import.meta.env.WHATSAPP_TEMPLATE_LANGUAGE as string | undefined) ?? "pt_BR";

  const whenLabel = formatWhen(scheduledAt);
  // Ordem dos parâmetros ({{1}}, {{2}}, {{3}}) precisa bater com o corpo do
  // template aprovado na Meta.
  const bodyParameters = [patientName, whenLabel, locationLabel];
  const bodyPreview = `Consulta de ${patientName} marcada para ${whenLabel} — ${locationLabel}.`;

  let status: string;

  if (!templateName) {
    status = "skipped_no_template";
    console.warn(
      "[whatsapp] WHATSAPP_TEMPLATE_CONFIRMATION não configurado — confirmação não enviada, apenas registrada."
    );
  } else {
    try {
      const { id } = await sendTemplateMessage({
        to: guardianPhone,
        templateName,
        languageCode,
        bodyParameters,
      });
      status = "sent";
      console.log(`[whatsapp] confirmação enviada (${id}) para ${guardianPhone}`);
    } catch (err) {
      status = "failed";
      console.error(
        "[whatsapp] falha ao enviar confirmação:",
        err instanceof Error ? err.message : String(err)
      );
    }
  }

  const { error } = await supabase.from("whatsapp_messages").insert({
    appointment_id: appointmentId,
    guardian_id: guardianId,
    direction: "outbound",
    message_type: "appointment_confirmation",
    template_name: templateName ?? null,
    body: bodyPreview,
    status,
  });

  if (error) {
    console.error("[whatsapp] falha ao registrar whatsapp_messages:", error.message);
  }

  return status;
}
