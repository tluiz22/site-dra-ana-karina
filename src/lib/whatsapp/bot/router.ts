// Roteador da máquina de estados do bot de WhatsApp (Fase 3b).
//
// Chamado pelo webhook (`src/pages/api/whatsapp/webhook.ts`) para cada
// mensagem inbound do paciente, depois que ela já foi registrada em
// `whatsapp_messages`. Cobre WELCOME → MENU → INFO_MENU e MENU → HUMAN_HANDOFF
// ("Falar com secretária" é opção do menu principal, não do submenu de
// Informações — pedido do cliente) e delega os estados de Agendar (case 1,
// `./booking.ts`), Cancelar (case 2, `./cancel.ts`) e Remarcar (case 3,
// `./reschedule.ts`) — os quatro cases do menu principal completos.
//
// Nunca lança: erros de uma etapa não devem impedir o webhook de responder
// 200 rápido para a Meta.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { WaMessage } from "../types";
import { sendInteractiveListMessage, sendTextMessage } from "../client";
import {
  extractSelection,
  isBackToMenuSelection,
  isPastHumanHandoffDeadline,
  isPastIdleTimeout,
  matchesOption,
  resolveGuardianId,
  sendAndLog,
  updateConversationState,
  type Selection,
} from "./shared";
import { BOOKING_STATES, handleBookingState, startBooking } from "./booking";
import { CANCEL_STATES, handleCancelState, startCancel } from "./cancel";
import { RESCHEDULE_STATES, handleRescheduleState, startReschedule } from "./reschedule";
import * as texts from "./messages";

interface ConversationStateRow {
  state: string;
  guardian_id: string | null;
  atendimento_humano: boolean;
  context: Record<string, unknown> | null;
  updated_at: string;
}

export async function routeIncomingMessage(
  supabase: SupabaseClient,
  guardianPhone: string,
  waMsg: WaMessage
): Promise<void> {
  const { data: convo, error } = await supabase
    .from("conversation_state")
    .select("state, guardian_id, atendimento_humano, context, updated_at")
    .eq("guardian_phone", guardianPhone)
    .maybeSingle<ConversationStateRow>();

  if (error || !convo) {
    console.error(
      "[whatsapp bot] conversation_state não encontrada para",
      guardianPhone,
      error?.message
    );
    return;
  }

  console.log(
    "[whatsapp bot] estado lido:",
    guardianPhone,
    "state=" + convo.state,
    "atendimento_humano=" + convo.atendimento_humano
  );

  // Secretária conduzindo a conversa pelo app (coexistência) — o bot fica em
  // silêncio, a menos que o prazo de resposta já tenha vencido (24h corridas,
  // nunca vencendo num fim de semana — "até o próximo dia útil"). Nesse caso,
  // devolve ao bot sozinho, sem depender da secretária lembrar de digitar
  // `#bot`, e reinicia do zero (WELCOME) — o responsável pode não lembrar
  // mais em que ponto a conversa parou depois de tanto tempo.
  if (convo.atendimento_humano) {
    if (!isPastHumanHandoffDeadline(new Date(convo.updated_at))) return;
    await updateConversationState(supabase, guardianPhone, "WELCOME", {
      atendimento_humano: false,
      context: {},
    });
    convo.state = "WELCOME";
    convo.atendimento_humano = false;
  }

  const guardianId = convo.guardian_id ?? (await resolveGuardianId(supabase, guardianPhone));
  const selection = extractSelection(waMsg);

  // Timeout de inatividade (15min, ver `isPastIdleTimeout`): a conversa
  // estava num sub-fluxo (fora de WELCOME/MENU) e ficou parada tempo demais
  // — reinicia do zero em vez de tentar reencaixar esta mensagem num
  // contexto que o responsável provavelmente já esqueceu.
  if (
    convo.state !== "WELCOME" &&
    convo.state !== "MENU" &&
    isPastIdleTimeout(new Date(convo.updated_at))
  ) {
    await updateConversationState(supabase, guardianPhone, "WELCOME", { context: {} });
    convo.state = "WELCOME";
    convo.context = {};
  }

  const context = convo.context ?? {};

  // "Voltar ao menu principal" funciona em qualquer estado do meio da
  // conversa (toque na opção da lista, ou digitar "0"/"menu") — pedido do
  // cliente para não deixar o responsável preso num sub-fluxo. WELCOME/MENU
  // ficam de fora: já mostram o menu ou ainda nem chegaram lá.
  if (convo.state !== "WELCOME" && convo.state !== "MENU" && isBackToMenuSelection(selection)) {
    await updateConversationState(supabase, guardianPhone, "MENU", { context: {} });
    await sendMenu(supabase, guardianPhone, guardianId);
    return;
  }

  if (BOOKING_STATES.has(convo.state)) {
    await handleBookingState(supabase, guardianPhone, guardianId, convo.state, context, selection);
    return;
  }

  if (RESCHEDULE_STATES.has(convo.state)) {
    await handleRescheduleState(supabase, guardianPhone, guardianId, context, selection);
    return;
  }

  if (CANCEL_STATES.has(convo.state)) {
    await handleCancelState(supabase, guardianPhone, guardianId, convo.state, context, selection);
    return;
  }

  switch (convo.state) {
    case "WELCOME":
      await handleWelcome(supabase, guardianPhone, guardianId);
      return;
    case "MENU":
      await handleMenu(supabase, guardianPhone, guardianId, selection);
      return;
    case "INFO_MENU":
      await handleInfoMenu(supabase, guardianPhone, guardianId, selection);
      return;
    default:
      // Estado desconhecido/obsoleto (ex.: enum antigo já removido da
      // máquina de estados) — devolve para o menu principal em vez de
      // deixar a conversa travada num estado sem handler.
      await updateConversationState(supabase, guardianPhone, "MENU");
      await sendMenu(supabase, guardianPhone, guardianId);
  }
}

// --- menus (compartilhados por WELCOME/MENU/INFO_MENU) --------------------

export async function sendMenu(
  supabase: SupabaseClient,
  guardianPhone: string,
  guardianId: string | null
): Promise<void> {
  const body = texts.menuBodyText();
  await sendAndLog(supabase, guardianId, "bot_menu", body, () =>
    sendInteractiveListMessage({
      to: guardianPhone,
      bodyText: body,
      buttonText: "Escolher opção",
      sections: texts.menuSections(),
    })
  );
}

async function sendInfoMenu(
  supabase: SupabaseClient,
  guardianPhone: string,
  guardianId: string | null
): Promise<void> {
  const body = texts.infoMenuBodyText();
  await sendAndLog(supabase, guardianId, "bot_info_menu", body, () =>
    sendInteractiveListMessage({
      to: guardianPhone,
      bodyText: body,
      buttonText: "Escolher opção",
      sections: texts.infoMenuSections(),
    })
  );
}

// --- WELCOME --------------------------------------------------------------

async function handleWelcome(
  supabase: SupabaseClient,
  guardianPhone: string,
  guardianId: string | null
): Promise<void> {
  const welcome = texts.welcomeText();
  await sendAndLog(supabase, guardianId, "bot_welcome", welcome, () =>
    sendTextMessage({ to: guardianPhone, body: welcome })
  );
  await sendMenu(supabase, guardianPhone, guardianId);
  await updateConversationState(supabase, guardianPhone, "MENU");
}

// --- MENU -------------------------------------------------------------

async function handleMenu(
  supabase: SupabaseClient,
  guardianPhone: string,
  guardianId: string | null,
  selection: Selection
): Promise<void> {
  if (matchesOption(selection, "1", texts.MENU_LIST_ID.agendarConsulta)) {
    await startBooking(supabase, guardianPhone, guardianId, "first_visit");
    return;
  }

  if (matchesOption(selection, "2", texts.MENU_LIST_ID.agendarRetorno)) {
    await startBooking(supabase, guardianPhone, guardianId, "return_visit");
    return;
  }

  if (matchesOption(selection, "3", texts.MENU_LIST_ID.cancelar)) {
    await startCancel(supabase, guardianPhone, guardianId);
    return;
  }

  if (matchesOption(selection, "4", texts.MENU_LIST_ID.remarcar)) {
    await startReschedule(supabase, guardianPhone, guardianId);
    return;
  }

  if (matchesOption(selection, "5", texts.MENU_LIST_ID.informacoes)) {
    await sendInfoMenu(supabase, guardianPhone, guardianId);
    await updateConversationState(supabase, guardianPhone, "INFO_MENU");
    return;
  }

  if (matchesOption(selection, "6", texts.MENU_LIST_ID.secretaria)) {
    const body = texts.handoffText();
    await sendAndLog(supabase, guardianId, "bot_handoff", body, () =>
      sendTextMessage({ to: guardianPhone, body })
    );
    await updateConversationState(supabase, guardianPhone, "HUMAN_HANDOFF", { atendimento_humano: true });
    return;
  }

  const notUnderstood = texts.notUnderstoodText(true);
  await sendAndLog(supabase, guardianId, "bot_not_understood", notUnderstood, () =>
    sendTextMessage({ to: guardianPhone, body: notUnderstood })
  );
  await sendMenu(supabase, guardianPhone, guardianId);
}

// --- INFO_MENU (case 4 · Informações Gerais) -------------------------------

async function handleInfoMenu(
  supabase: SupabaseClient,
  guardianPhone: string,
  guardianId: string | null,
  selection: Selection
): Promise<void> {
  if (matchesOption(selection, "1", texts.INFO_LIST_ID.valores)) {
    const { data } = await supabase
      .from("clinic_locations")
      .select("name, type, price_first_visit_cents")
      .eq("is_active", true);
    const body = texts.valoresText(data ?? []);
    await sendAndLog(supabase, guardianId, "bot_info_valores", body, () =>
      sendTextMessage({ to: guardianPhone, body })
    );
    await sendInfoMenu(supabase, guardianPhone, guardianId);
    return;
  }

  if (matchesOption(selection, "2", texts.INFO_LIST_ID.convenios)) {
    const body = texts.conveniosText();
    await sendAndLog(supabase, guardianId, "bot_info_convenios", body, () =>
      sendTextMessage({ to: guardianPhone, body })
    );
    await sendInfoMenu(supabase, guardianPhone, guardianId);
    return;
  }

  if (matchesOption(selection, "3", texts.INFO_LIST_ID.endereco)) {
    const { data } = await supabase
      .from("clinic_locations")
      .select("name, address")
      .eq("type", "clinic")
      .eq("is_active", true);
    const body = texts.enderecoText(data ?? []);
    await sendAndLog(supabase, guardianId, "bot_info_endereco", body, () =>
      sendTextMessage({ to: guardianPhone, body })
    );
    await sendInfoMenu(supabase, guardianPhone, guardianId);
    return;
  }

  const notUnderstood = texts.notUnderstoodText();
  await sendAndLog(supabase, guardianId, "bot_not_understood", notUnderstood, () =>
    sendTextMessage({ to: guardianPhone, body: notUnderstood })
  );
  await sendInfoMenu(supabase, guardianPhone, guardianId);
}
