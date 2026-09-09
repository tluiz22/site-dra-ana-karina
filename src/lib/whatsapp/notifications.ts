// Notificações de agendamento por WhatsApp (Fase 3a).
//
// Camada acima do cliente de baixo nível (`./client`): monta os parâmetros
// do template aprovado na Meta, dispara o envio e SEMPRE registra a
// mensagem em `whatsapp_messages`. É melhor esforço — uma falha no envio ou
// no log não deve reverter a operação (marcar/remarcar/cancelar) que a
// originou.

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

interface NotificationInput {
  supabase: SupabaseClient;
  appointmentId: string;
  guardianId: string;
  guardianPhone: string; // E.164, ex.: "+5584981880777"
  patientName: string;
  scheduledAt: Date;
  locationLabel: string; // "Consultório" | "Domiciliar"
}

interface NotificationSpec {
  messageType: string;
  // Nome do template aprovado na Meta (de uma env var). Resolvido pelo
  // chamador com referência estática, pois `import.meta.env[chave]` dinâmico
  // não é confiável no build do Astro.
  templateName: string | undefined;
  buildPreview: (patientName: string, whenLabel: string, locationLabel: string) => string;
}

// Dispara uma notificação e grava o log. Retorna o status registrado
// (`sent` | `failed` | `skipped_no_template`); nunca lança.
async function sendNotification(
  { supabase, appointmentId, guardianId, guardianPhone, patientName, scheduledAt, locationLabel }: NotificationInput,
  spec: NotificationSpec
): Promise<string> {
  const languageCode = (import.meta.env.WHATSAPP_TEMPLATE_LANGUAGE as string | undefined) ?? "pt_BR";

  const whenLabel = formatWhen(scheduledAt);
  // Ordem dos parâmetros ({{1}}, {{2}}, {{3}}) precisa bater com o corpo do
  // template aprovado na Meta.
  const bodyParameters = [patientName, whenLabel, locationLabel];
  const bodyPreview = spec.buildPreview(patientName, whenLabel, locationLabel);

  let status: string;

  if (!spec.templateName) {
    status = "skipped_no_template";
    console.warn(
      `[whatsapp] template de ${spec.messageType} não configurado — não enviado, apenas registrado.`
    );
  } else {
    try {
      const { id } = await sendTemplateMessage({
        to: guardianPhone,
        templateName: spec.templateName,
        languageCode,
        bodyParameters,
      });
      status = "sent";
      console.log(`[whatsapp] ${spec.messageType} enviado (${id}) para ${guardianPhone}`);
    } catch (err) {
      status = "failed";
      console.error(
        `[whatsapp] falha ao enviar ${spec.messageType}:`,
        err instanceof Error ? err.message : String(err)
      );
    }
  }

  const { error } = await supabase.from("whatsapp_messages").insert({
    appointment_id: appointmentId,
    guardian_id: guardianId,
    direction: "outbound",
    message_type: spec.messageType,
    template_name: spec.templateName ?? null,
    body: bodyPreview,
    status,
  });

  if (error) {
    console.error("[whatsapp] falha ao registrar whatsapp_messages:", error.message);
  }

  return status;
}

// Consulta recém-marcada.
export function sendAppointmentConfirmation(input: NotificationInput): Promise<string> {
  return sendNotification(input, {
    messageType: "appointment_confirmation",
    templateName: import.meta.env.WHATSAPP_TEMPLATE_CONFIRMATION,
    buildPreview: (name, when, location) => `Consulta de ${name} marcada para ${when} — ${location}.`,
  });
}

// Consulta remarcada — `scheduledAt`/`locationLabel` são os novos valores.
export function sendAppointmentReschedule(input: NotificationInput): Promise<string> {
  return sendNotification(input, {
    messageType: "appointment_reschedule",
    templateName: import.meta.env.WHATSAPP_TEMPLATE_RESCHEDULE,
    buildPreview: (name, when, location) => `Consulta de ${name} remarcada para ${when} — ${location}.`,
  });
}

// Consulta cancelada — `scheduledAt`/`locationLabel` são os valores que
// estavam agendados.
export function sendAppointmentCancellation(input: NotificationInput): Promise<string> {
  return sendNotification(input, {
    messageType: "appointment_cancellation",
    templateName: import.meta.env.WHATSAPP_TEMPLATE_CANCELLATION,
    buildPreview: (name, when, location) => `Consulta de ${name} de ${when} — ${location} foi cancelada.`,
  });
}
