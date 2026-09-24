// Notificações de agendamento por WhatsApp (Fase 3a).
//
// Camada acima do cliente de baixo nível (`./client`): monta os parâmetros
// do template aprovado na Meta, dispara o envio e SEMPRE registra a
// mensagem em `whatsapp_messages`. É melhor esforço — uma falha no envio ou
// no log não deve reverter a operação (marcar/remarcar/cancelar) que a
// originou.

import type { SupabaseClient } from "@supabase/supabase-js";
import { sendTemplateMessage } from "./client";
import { formatWhen } from "./formatDateTime";
import { formatCentsBRL } from "../money";
import { updateConversationState } from "./bot/shared";

interface NotificationInput {
  supabase: SupabaseClient;
  appointmentId: string;
  guardianId: string;
  guardianPhone: string; // E.164, ex.: "+5584981880777"
  patientName: string;
  // "Consulta" | "Retorno" | "Exame (<nome do exame>)" — primeira variável
  // do template (set/2026). Evita concordância de gênero na frase
  // ("a consulta ... confirmada" vs "o exame ... confirmado" não cabem na
  // mesma frase com uma variável simples): o texto do template não flexiona
  // nada, só encaixa esse rótulo pronto ("Atendimento confirmado: {{1}}...").
  typeLabel: string;
  scheduledAt: Date;
  locationLabel: string; // "Consultório" | "Domiciliar" | "Exames"
  // Endereço completo do local (`clinic_locations.address`) — nulo para
  // atendimento domiciliar (não há endereço fixo, é a equipe que vai até a
  // casa). Só usado pelas notificações que incluem "onde será a consulta"
  // (confirmação, remarcação, lembrete) — o cancelamento não precisa.
  locationAddress?: string | null;
  // Valor da consulta em centavos (`clinic_locations.price_first_visit_cents`).
  // Nulo/omitido para retorno — o retorno não tem valor próprio, está
  // incluso no valor da consulta anterior (decisão do cliente). Só usado na
  // confirmação — pedido do cliente, para o responsável já saber o valor e a
  // forma de pagamento na primeira mensagem que recebe.
  priceCents?: number | null;
}

interface NotificationSpec {
  messageType: string;
  // Nome do template aprovado na Meta (de uma env var). Resolvido pelo
  // chamador com referência estática, pois `import.meta.env[chave]` dinâmico
  // não é confiável no build do Astro.
  templateName: string | undefined;
  // Quando true, adiciona o endereço como próxima variável do template —
  // usado nas notificações que precisam dizer ao responsável onde será a
  // consulta.
  includeAddress?: boolean;
  // Quando true, adiciona o valor da consulta como próxima variável — só a
  // confirmação usa.
  includePrice?: boolean;
  buildPreview: (
    typeLabel: string,
    patientName: string,
    whenLabel: string,
    locationLabel: string,
    addressText: string | null,
    priceText: string | null
  ) => string;
}

// "Consulta" | "Retorno" | "Exame (<nome>)" — ver NotificationInput.typeLabel.
export function buildAppointmentTypeLabel(
  appointmentType: string,
  examName?: string | null
): string {
  if (appointmentType === "exam") return examName ? `Exame (${examName})` : "Exame";
  return appointmentType === "return_visit" ? "Retorno" : "Consulta";
}

// Texto do endereço/localização enviado como variável do template. Sem
// endereço cadastrado (atendimento domiciliar), usa um texto fixo em vez do
// endereço do consultório — não faz sentido mandar o endereço da clínica
// quando é a equipe que vai até a casa do paciente.
function buildLocationAddressText(address: string | null | undefined): string {
  if (!address) {
    return "A equipe estará no endereço combinado com você.";
  }
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
  return `Endereço: ${address}. Localização: ${mapsUrl}`;
}

// Texto do valor enviado como variável do template — frase completa (não só
// o número) porque o retorno não tem valor próprio, está incluso no valor
// da consulta anterior (decisão do cliente), e as duas frases precisam
// funcionar dentro do mesmo template aprovado na Meta.
function buildPriceText(priceCents: number | null | undefined): string {
  if (priceCents == null) {
    return "O retorno está incluso no valor da consulta anterior.";
  }
  return `O valor é de ${formatCentsBRL(priceCents)}.`;
}

// Dispara uma notificação e grava o log. Retorna o status registrado
// (`sent` | `failed` | `skipped_no_template`); nunca lança.
async function sendNotification(
  {
    supabase,
    appointmentId,
    guardianId,
    guardianPhone,
    patientName,
    typeLabel,
    scheduledAt,
    locationLabel,
    locationAddress,
    priceCents,
  }: NotificationInput,
  spec: NotificationSpec
): Promise<string> {
  const languageCode = (import.meta.env.WHATSAPP_TEMPLATE_LANGUAGE as string | undefined) ?? "pt_BR";

  const whenLabel = formatWhen(scheduledAt);
  const addressText = spec.includeAddress ? buildLocationAddressText(locationAddress) : null;
  const priceText = spec.includePrice ? buildPriceText(priceCents) : null;

  // Ordem dos parâmetros ({{1}} tipo, {{2}} nome, {{3}} data-hora, {{4}}
  // local, {{5}} endereço, {{6}} valor) precisa bater com o corpo do
  // template aprovado na Meta — endereço e valor só entram quando a
  // notificação os usa. "Tipo" entra em set/2026 pra reaproveitar os mesmos
  // templates entre consulta/retorno/exame (ver NotificationInput.typeLabel).
  const bodyParameters = [typeLabel, patientName, whenLabel, locationLabel];
  if (addressText !== null) bodyParameters.push(addressText);
  if (priceText !== null) bodyParameters.push(priceText);

  const bodyPreview = spec.buildPreview(typeLabel, patientName, whenLabel, locationLabel, addressText, priceText);

  let status: string;
  let waMessageId: string | null = null;

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
      waMessageId = id;
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
    wa_message_id: waMessageId,
  });

  if (error) {
    console.error("[whatsapp] falha ao registrar whatsapp_messages:", error.message);
  }

  // Essas notificações (confirmação/remarcação/cancelamento/lembrete) não
  // passam pelo roteador do bot — sem isso, a conversa ficava parada em
  // qualquer estado que estivesse antes (ex.: MENU de uma interação
  // anterior), e um "ok" de resposta à notificação caía direto em "não
  // entendi" em vez de reiniciar do zero. Reseta mesmo se o envio falhou ou
  // o template ainda não foi aprovado — a ação (marcar/remarcar/cancelar) já
  // aconteceu de verdade no sistema, independente da entrega da mensagem.
  await updateConversationState(supabase, guardianPhone, "WELCOME", { context: {} });

  return status;
}

// Consulta/retorno/exame recém-marcado.
export function sendAppointmentConfirmation(input: NotificationInput): Promise<string> {
  return sendNotification(input, {
    messageType: "appointment_confirmation",
    templateName: import.meta.env.WHATSAPP_TEMPLATE_CONFIRMATION,
    includeAddress: true,
    includePrice: true,
    buildPreview: (type, name, when, location, address, price) =>
      `Atendimento confirmado: ${type} de ${name}, para ${when}, no ${location}. ${address} ${price} ` +
      "Atendimento somente particular — pagamento em dinheiro, transferência bancária ou PIX.",
  });
}

// Consulta/retorno/exame remarcado — `scheduledAt`/`locationLabel` são os
// novos valores.
export function sendAppointmentReschedule(input: NotificationInput): Promise<string> {
  return sendNotification(input, {
    messageType: "appointment_reschedule",
    templateName: import.meta.env.WHATSAPP_TEMPLATE_RESCHEDULE,
    includeAddress: true,
    buildPreview: (type, name, when, location, address) =>
      `Atendimento remarcado: ${type} de ${name}, para ${when}, no ${location}. ${address}`,
  });
}

// Consulta/retorno/exame cancelado — `scheduledAt`/`locationLabel` são os
// valores que estavam agendados. Sem endereço: não há mais consulta pra
// dizer onde é.
export function sendAppointmentCancellation(input: NotificationInput): Promise<string> {
  return sendNotification(input, {
    messageType: "appointment_cancellation",
    templateName: import.meta.env.WHATSAPP_TEMPLATE_CANCELLATION,
    buildPreview: (type, name, when, location) =>
      `Atendimento cancelado: ${type} de ${name}, marcado para ${when}, no ${location}. ` +
      "Se quiser remarcar, é só responder por aqui.",
  });
}

// Lembrete disparado pelo cron ~1 dia antes da consulta/retorno/exame.
export function sendAppointmentReminder(input: NotificationInput): Promise<string> {
  return sendNotification(input, {
    messageType: "appointment_reminder",
    templateName: import.meta.env.WHATSAPP_TEMPLATE_REMINDER,
    includeAddress: true,
    buildPreview: (type, name, when, location, address) =>
      `Lembrete: ${type} de ${name} é amanhã, ${when}, no ${location}. ${address} ` +
      "Nos vemos em breve! Qualquer dúvida ou se precisar remarcar, é só responder esta mensagem.",
  });
}
