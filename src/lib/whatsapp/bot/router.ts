// Roteador da máquina de estados do bot de WhatsApp (Fase 3b).
//
// Chamado pelo webhook (`src/pages/api/whatsapp/webhook.ts`) para cada
// mensagem inbound do paciente, depois que ela já foi registrada em
// `whatsapp_messages`. Cobre por enquanto WELCOME → MENU → INFO_MENU →
// HUMAN_HANDOFF (case 4 · Informações Gerais, completo) — os cases
// Agendar/Cancelar/Remarcar (1–3) respondem com um texto provisório até
// serem implementados nas próximas etapas (ver checkpoint do plano).
//
// Nunca lança: erros de uma etapa não devem impedir o webhook de responder
// 200 rápido para a Meta.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { WaMessage } from "../types";
import { sendInteractiveListMessage, sendTextMessage } from "../client";
import { resolveGuardianId } from "./shared";
import * as texts from "./messages";

interface Selection {
  id: string | null;
  text: string;
}

interface ConversationStateRow {
  state: string;
  guardian_id: string | null;
  atendimento_humano: boolean;
}

export async function routeIncomingMessage(
  supabase: SupabaseClient,
  guardianPhone: string,
  waMsg: WaMessage
): Promise<void> {
  const { data: convo, error } = await supabase
    .from("conversation_state")
    .select("state, guardian_id, atendimento_humano")
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

  // Secretária conduzindo a conversa pelo app (coexistência) — o bot fica em
  // silêncio; a mensagem já foi registrada pelo webhook antes desta chamada.
  if (convo.atendimento_humano) return;

  const guardianId = convo.guardian_id ?? (await resolveGuardianId(supabase, guardianPhone));
  const selection = extractSelection(waMsg);

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
      // Estados dos cases 1–3 (Agendar/Cancelar/Remarcar) ainda não
      // implementados no roteador — devolve para o menu principal em vez de
      // deixar a conversa travada num estado sem handler.
      await setState(supabase, guardianPhone, "MENU");
      await sendMenu(supabase, guardianPhone, guardianId);
  }
}

// --- extração da resposta do usuário ------------------------------------

function extractSelection(waMsg: WaMessage): Selection {
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
function matchesOption(selection: Selection, digit: string, listId: string): boolean {
  if (selection.id === listId) return true;
  const normalized = selection.text.toLowerCase();
  return normalized === digit || normalized.startsWith(`${digit}.`) || normalized.startsWith(`${digit} `);
}

// --- estado -------------------------------------------------------------

async function setState(
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

// --- envio + log ----------------------------------------------------------

async function sendAndLog(
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

async function sendMenu(
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
  await setState(supabase, guardianPhone, "MENU");
}

// --- MENU -------------------------------------------------------------

async function handleMenu(
  supabase: SupabaseClient,
  guardianPhone: string,
  guardianId: string | null,
  selection: Selection
): Promise<void> {
  if (
    matchesOption(selection, "1", texts.MENU_LIST_ID.agendar) ||
    matchesOption(selection, "2", texts.MENU_LIST_ID.cancelar) ||
    matchesOption(selection, "3", texts.MENU_LIST_ID.remarcar)
  ) {
    const body = texts.comingSoonText();
    await sendAndLog(supabase, guardianId, "bot_coming_soon", body, () =>
      sendTextMessage({ to: guardianPhone, body })
    );
    await sendMenu(supabase, guardianPhone, guardianId);
    return;
  }

  if (matchesOption(selection, "4", texts.MENU_LIST_ID.informacoes)) {
    await sendInfoMenu(supabase, guardianPhone, guardianId);
    await setState(supabase, guardianPhone, "INFO_MENU");
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
    await setState(supabase, guardianPhone, "HUMAN_HANDOFF", { atendimento_humano: true });
    return;
  }

  const notUnderstood = texts.notUnderstoodText();
  await sendAndLog(supabase, guardianId, "bot_not_understood", notUnderstood, () =>
    sendTextMessage({ to: guardianPhone, body: notUnderstood })
  );
  await sendInfoMenu(supabase, guardianPhone, guardianId);
}
