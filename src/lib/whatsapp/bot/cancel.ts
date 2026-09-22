// Case 2 · Cancelar (Fase 3b) — estados CANCEL_SELECT e CANCEL_CONFIRM da
// máquina de estados do bot.
//
// Mesma identificação usada no case 3 · Remarcar (reaproveita
// `fetchUpcomingAppointments` de `./shared`): até 3 consultas/exames futuros
// viram lista de escolha; mais de 3, pergunta a data de nascimento da
// criança para filtrar. Diferente de Agendar/Remarcar, aqui a ação é
// imediata e destrutiva — por isso o diagrama do plano tem um estado extra
// (CANCEL_CONFIRM) só para o Sim/Não antes de cancelar de fato.
//
// "category" (consulta vs exame, ver shared.ts) acompanha o contexto a
// conversa inteira — Consultas > Cancelar nunca deve listar/mencionar um
// exame, e vice-versa, mesmo sendo o mesmo fluxo por baixo dos panos.

import type { SupabaseClient } from "@supabase/supabase-js";
import { sendInteractiveListMessage, sendTextMessage } from "../client";
import { formatWhen } from "../formatDateTime";
import { cancelEvent } from "../../google/calendar";
import {
  fetchUpcomingAppointments,
  parseBirthdateInput,
  resolveByListOrDigit,
  sendAndLog,
  updateConversationState,
  type AppointmentCandidate,
  type AppointmentCategory,
  type Selection,
} from "./shared";
import * as texts from "./messages";

export const CANCEL_STATES: ReadonlySet<string> = new Set(["CANCEL_SELECT", "CANCEL_CONFIRM"]);

interface CancelContext {
  category: AppointmentCategory;
  awaiting?: "appointment_choice" | "birthdate_search";
  candidates?: AppointmentCandidate[];
  pending_appointment?: AppointmentCandidate;
}

// Consultas > Cancelar ou Exames > Cancelar → identifica a(s) consulta(s)/
// exame(s) futuro(s) desse responsável, já filtrado pela categoria certa
// (nunca mistura consulta com exame).
export async function startCancel(
  supabase: SupabaseClient,
  guardianPhone: string,
  guardianId: string | null,
  category: AppointmentCategory
): Promise<void> {
  if (!guardianId) {
    const body = texts.cancelNoGuardianText();
    await sendAndLog(supabase, guardianId, "bot_cancel_no_guardian", body, () =>
      sendTextMessage({ to: guardianPhone, body })
    );
    await updateConversationState(supabase, guardianPhone, "MENU", { context: {} });
    return;
  }

  const candidates = await fetchUpcomingAppointments(supabase, guardianId, category);
  await presentCandidates(supabase, guardianPhone, guardianId, category, candidates);
}

export async function handleCancelState(
  supabase: SupabaseClient,
  guardianPhone: string,
  guardianId: string | null,
  state: string,
  rawContext: Record<string, unknown>,
  selection: Selection
): Promise<void> {
  const context = rawContext as unknown as CancelContext;

  if (state === "CANCEL_SELECT") {
    await handleCancelSelect(supabase, guardianPhone, guardianId, context, selection);
    return;
  }

  if (state === "CANCEL_CONFIRM") {
    await handleCancelConfirm(supabase, guardianPhone, guardianId, context, selection);
  }
}

// --- CANCEL_SELECT (identificação) ---------------------------------------

async function handleCancelSelect(
  supabase: SupabaseClient,
  guardianPhone: string,
  guardianId: string | null,
  context: CancelContext,
  selection: Selection
): Promise<void> {
  if (context.awaiting === "appointment_choice") {
    const candidates = context.candidates ?? [];
    const match = resolveByListOrDigit(selection, candidates, (c) => `cancel_${c.id}`);
    if (!match) {
      const body = texts.notUnderstoodText();
      await sendAndLog(supabase, guardianId, "bot_not_understood", body, () =>
        sendTextMessage({ to: guardianPhone, body })
      );
      await sendAppointmentChoice(supabase, guardianPhone, guardianId, context.category, candidates);
      return;
    }
    await goToConfirm(supabase, guardianPhone, guardianId, context.category, match);
    return;
  }

  if (context.awaiting === "birthdate_search") {
    const isoBirthdate = parseBirthdateInput(selection.text);
    if (!isoBirthdate) {
      const body = texts.invalidBirthdateText();
      await sendAndLog(supabase, guardianId, "bot_invalid_birthdate", body, () =>
        sendTextMessage({ to: guardianPhone, body })
      );
      return;
    }

    const matches = (context.candidates ?? []).filter((c) => c.birthdate === isoBirthdate);

    if (matches.length === 0) {
      const body = texts.noMatchingAppointmentText(context.category);
      await sendAndLog(supabase, guardianId, "bot_cancel_no_match", body, () =>
        sendTextMessage({ to: guardianPhone, body })
      );
      await updateConversationState(supabase, guardianPhone, "MENU", { context: {} });
      return;
    }

    if (matches.length === 1) {
      await goToConfirm(supabase, guardianPhone, guardianId, context.category, matches[0]);
      return;
    }

    // Mais de uma consulta para a mesma data de nascimento (ex.: gêmeos).
    await sendAppointmentChoice(supabase, guardianPhone, guardianId, context.category, matches);
    await updateConversationState(supabase, guardianPhone, "CANCEL_SELECT", {
      context: { category: context.category, awaiting: "appointment_choice", candidates: matches } satisfies CancelContext,
    });
  }
}

// --- CANCEL_CONFIRM (Sim/Não antes de cancelar de fato) --------------------

async function handleCancelConfirm(
  supabase: SupabaseClient,
  guardianPhone: string,
  guardianId: string | null,
  context: CancelContext,
  selection: Selection
): Promise<void> {
  const pending = context.pending_appointment;
  if (!pending) {
    const body = texts.couldNotIdentifyAppointmentText(context.category);
    await sendAndLog(supabase, guardianId, "bot_cancel_error", body, () =>
      sendTextMessage({ to: guardianPhone, body })
    );
    await updateConversationState(supabase, guardianPhone, "MENU", { context: {} });
    return;
  }

  const answer = selection.text.trim().toLowerCase();

  if (answer.startsWith("s")) {
    await performCancel(supabase, guardianPhone, guardianId, context.category, pending);
    return;
  }

  if (answer.startsWith("n")) {
    const body = texts.cancelAbortedText(context.category);
    await sendAndLog(supabase, guardianId, "bot_cancel_aborted", body, () =>
      sendTextMessage({ to: guardianPhone, body })
    );
    await updateConversationState(supabase, guardianPhone, "MENU", { context: {} });
    return;
  }

  const notUnderstood = texts.notUnderstoodYesNoText();
  await sendAndLog(supabase, guardianId, "bot_not_understood", notUnderstood, () =>
    sendTextMessage({ to: guardianPhone, body: notUnderstood })
  );
  const body = texts.confirmCancelText(
    pending.patient_name,
    formatWhen(new Date(pending.scheduled_at)),
    context.category
  );
  await sendAndLog(supabase, guardianId, "bot_cancel_confirm", body, () =>
    sendTextMessage({ to: guardianPhone, body })
  );
}

// --- ação de cancelar de fato ---------------------------------------------

async function performCancel(
  supabase: SupabaseClient,
  guardianPhone: string,
  guardianId: string | null,
  category: AppointmentCategory,
  appointment: AppointmentCandidate
): Promise<void> {
  if (appointment.google_event_id) {
    try {
      await cancelEvent(appointment.google_event_id);
    } catch (err) {
      console.error(
        "[whatsapp bot] erro ao cancelar evento no Google Calendar:",
        err instanceof Error ? err.message : String(err)
      );
      const body = texts.cancelErrorText();
      await sendAndLog(supabase, guardianId, "bot_cancel_error", body, () =>
        sendTextMessage({ to: guardianPhone, body })
      );
      await updateConversationState(supabase, guardianPhone, "MENU", { context: {} });
      return;
    }
  } else {
    console.error("[whatsapp bot] consulta sem google_event_id ao cancelar:", appointment.id);
  }

  const { error } = await supabase.from("appointments").update({ status: "canceled" }).eq("id", appointment.id);
  if (error) {
    console.error("[whatsapp bot] erro ao marcar consulta como cancelada:", error.message);
  }

  const body = texts.cancelSuccessText(
    appointment.patient_name,
    formatWhen(new Date(appointment.scheduled_at)),
    category
  );
  await sendAndLog(supabase, guardianId, "bot_cancel_success", body, () =>
    sendTextMessage({ to: guardianPhone, body })
  );
  await updateConversationState(supabase, guardianPhone, "MENU", { context: {} });
}

// --- helpers --------------------------------------------------------------

async function presentCandidates(
  supabase: SupabaseClient,
  guardianPhone: string,
  guardianId: string | null,
  category: AppointmentCategory,
  candidates: AppointmentCandidate[]
): Promise<void> {
  if (candidates.length === 0) {
    const body = texts.cancelNoAppointmentsText(category);
    await sendAndLog(supabase, guardianId, "bot_cancel_no_appointments", body, () =>
      sendTextMessage({ to: guardianPhone, body })
    );
    await updateConversationState(supabase, guardianPhone, "MENU", { context: {} });
    return;
  }

  if (candidates.length <= 3) {
    await sendAppointmentChoice(supabase, guardianPhone, guardianId, category, candidates);
    await updateConversationState(supabase, guardianPhone, "CANCEL_SELECT", {
      context: { category, awaiting: "appointment_choice", candidates } satisfies CancelContext,
    });
    return;
  }

  const body = texts.askBirthdateText();
  await sendAndLog(supabase, guardianId, "bot_cancel_ask_birthdate", body, () =>
    sendTextMessage({ to: guardianPhone, body })
  );
  await updateConversationState(supabase, guardianPhone, "CANCEL_SELECT", {
    context: { category, awaiting: "birthdate_search", candidates } satisfies CancelContext,
  });
}

async function sendAppointmentChoice(
  supabase: SupabaseClient,
  guardianPhone: string,
  guardianId: string | null,
  category: AppointmentCategory,
  candidates: AppointmentCandidate[]
): Promise<void> {
  const body = texts.appointmentChoiceBodyText("cancelar", category);
  await sendAndLog(supabase, guardianId, "bot_cancel_choice", body, () =>
    sendInteractiveListMessage({
      to: guardianPhone,
      bodyText: body,
      buttonText: "Escolher opção",
      sections: texts.appointmentListSections(candidates, "cancel"),
    })
  );
}

async function goToConfirm(
  supabase: SupabaseClient,
  guardianPhone: string,
  guardianId: string | null,
  category: AppointmentCategory,
  appointment: AppointmentCandidate
): Promise<void> {
  const body = texts.confirmCancelText(appointment.patient_name, formatWhen(new Date(appointment.scheduled_at)), category);
  await sendAndLog(supabase, guardianId, "bot_cancel_confirm", body, () =>
    sendTextMessage({ to: guardianPhone, body })
  );
  await updateConversationState(supabase, guardianPhone, "CANCEL_CONFIRM", {
    context: { category, pending_appointment: appointment } satisfies CancelContext,
  });
}
