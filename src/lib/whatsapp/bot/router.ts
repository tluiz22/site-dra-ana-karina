// Roteador da máquina de estados do bot de WhatsApp (Fase 3b).
//
// Chamado pelo webhook (`src/pages/api/whatsapp/webhook.ts`) para cada
// mensagem inbound do paciente, depois que ela já foi registrada em
// `whatsapp_messages`. Cobre WELCOME → MENU → INFO_MENU → HUMAN_HANDOFF
// (case 4 · Informações Gerais, completo) e delega os estados de Agendar
// (case 1, `./booking.ts`), Cancelar (case 2, `./cancel.ts`) e Remarcar
// (case 3, `./reschedule.ts`) — os quatro cases do menu principal completos.
//
// Nunca lança: erros de uma etapa não devem impedir o webhook de responder
// 200 rápido para a Meta.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { WaMessage } from "../types";
import { sendInteractiveListMessage, sendTextMessage } from "../client";
import {
  extractSelection,
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
}

export async function routeIncomingMessage(
  supabase: SupabaseClient,
  guardianPhone: string,
  waMsg: WaMessage
): Promise<void> {
  const { data: convo, error } = await supabase
    .from("conversation_state")
    .select("state, guardian_id, atendimento_humano, context")
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
  // silêncio; a mensagem já foi registrada pelo webhook antes desta chamada.
  if (convo.atendimento_humano) return;

  const guardianId = convo.guardian_id ?? (await resolveGuardianId(supabase, guardianPhone));
  const selection = extractSelection(waMsg);
  const context = convo.context ?? {};

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
  if (matchesOption(selection, "1", texts.MENU_LIST_ID.agendar)) {
    await startBooking(supabase, guardianPhone, guardianId);
    return;
  }

  if (matchesOption(selection, "2", texts.MENU_LIST_ID.cancelar)) {
    await startCancel(supabase, guardianPhone, guardianId);
    return;
  }

  if (matchesOption(selection, "3", texts.MENU_LIST_ID.remarcar)) {
    await startReschedule(supabase, guardianPhone, guardianId);
    return;
  }

  if (matchesOption(selection, "4", texts.MENU_LIST_ID.informacoes)) {
    await sendInfoMenu(supabase, guardianPhone, guardianId);
    await updateConversationState(supabase, guardianPhone, "INFO_MENU");
    return;
  }

  const notUnderstood = texts.notUnderstoodText();
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
      .select("name, type, price_first_visit_cents, price_return_visit_cents")
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
      .eq("is_active", true)
      .maybeSingle();
    const body = texts.enderecoText(data ?? null);
    await sendAndLog(supabase, guardianId, "bot_info_endereco", body, () =>
      sendTextMessage({ to: guardianPhone, body })
    );
    await sendInfoMenu(supabase, guardianPhone, guardianId);
    return;
  }

  if (matchesOption(selection, "4", texts.INFO_LIST_ID.secretaria)) {
    const body = texts.handoffText();
    await sendAndLog(supabase, guardianId, "bot_handoff", body, () =>
      sendTextMessage({ to: guardianPhone, body })
    );
    await updateConversationState(supabase, guardianPhone, "HUMAN_HANDOFF", { atendimento_humano: true });
    return;
  }

  const notUnderstood = texts.notUnderstoodText();
  await sendAndLog(supabase, guardianId, "bot_not_understood", notUnderstood, () =>
    sendTextMessage({ to: guardianPhone, body: notUnderstood })
  );
  await sendInfoMenu(supabase, guardianPhone, guardianId);
}
