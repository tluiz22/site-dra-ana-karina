// Case 3 · Remarcar (Fase 3b) — estado RESCHEDULE_SELECT da máquina de
// estados do bot.
//
// Mesma ideia de identificação usada no case 1 (nunca listar tudo às cegas
// para um responsável-convênio com muitas crianças vinculadas): até 3
// consultas futuras viram lista de escolha; mais de 3, pergunta a data de
// nascimento da criança para filtrar. Ao identificar a consulta, gera uma
// linha em `booking_links` (`mode=reschedule`) com o mesmo local/tipo da
// consulta atual — só a data/horário são escolhidos na página.

import type { SupabaseClient } from "@supabase/supabase-js";
import { sendInteractiveListMessage, sendTextMessage } from "../client";
import { formatWhen } from "../formatDateTime";
import {
  buildAppUrl,
  fetchUpcomingAppointments,
  parseBirthdateInput,
  resolveByListOrDigit,
  sendAndLog,
  updateConversationState,
  type AppointmentCandidate,
  type Selection,
} from "./shared";
import * as texts from "./messages";

export const RESCHEDULE_STATES: ReadonlySet<string> = new Set(["RESCHEDULE_SELECT"]);

interface RescheduleContext {
  awaiting?: "appointment_choice" | "birthdate_search" | "confirm_appointment";
  candidates?: AppointmentCandidate[];
  pending_appointment?: AppointmentCandidate;
}

// MENU opção 3 → identifica a(s) consulta(s) futura(s) desse responsável.
export async function startReschedule(
  supabase: SupabaseClient,
  guardianPhone: string,
  guardianId: string | null
): Promise<void> {
  if (!guardianId) {
    const body = texts.rescheduleNoGuardianText();
    await sendAndLog(supabase, guardianId, "bot_reschedule_no_guardian", body, () =>
      sendTextMessage({ to: guardianPhone, body })
    );
    await updateConversationState(supabase, guardianPhone, "MENU", { context: {} });
    return;
  }

  const candidates = await fetchUpcomingAppointments(supabase, guardianId);
  await presentCandidates(supabase, guardianPhone, guardianId, candidates);
}

export async function handleRescheduleState(
  supabase: SupabaseClient,
  guardianPhone: string,
  guardianId: string | null,
  rawContext: Record<string, unknown>,
  selection: Selection
): Promise<void> {
  const context = rawContext as RescheduleContext;

  if (context.awaiting === "appointment_choice") {
    const candidates = context.candidates ?? [];
    const match = resolveByListOrDigit(selection, candidates, (c) => `reschedule_${c.id}`);
    if (!match) {
      const body = texts.notUnderstoodText();
      await sendAndLog(supabase, guardianId, "bot_not_understood", body, () =>
        sendTextMessage({ to: guardianPhone, body })
      );
      await sendAppointmentChoice(supabase, guardianPhone, guardianId, candidates);
      return;
    }
    await finishReschedule(supabase, guardianPhone, guardianId, match);
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
      const body = texts.noMatchingAppointmentText();
      await sendAndLog(supabase, guardianId, "bot_reschedule_no_match", body, () =>
        sendTextMessage({ to: guardianPhone, body })
      );
      await updateConversationState(supabase, guardianPhone, "MENU", { context: {} });
      return;
    }

    if (matches.length === 1) {
      const pending = matches[0];
      const body = texts.confirmAppointmentText(pending.patient_name, formatWhen(new Date(pending.scheduled_at)));
      await sendAndLog(supabase, guardianId, "bot_reschedule_confirm", body, () =>
        sendTextMessage({ to: guardianPhone, body })
      );
      await updateConversationState(supabase, guardianPhone, "RESCHEDULE_SELECT", {
        context: { awaiting: "confirm_appointment", pending_appointment: pending } satisfies RescheduleContext,
      });
      return;
    }

    // Mais de uma consulta para a mesma data de nascimento (ex.: gêmeos).
    await sendAppointmentChoice(supabase, guardianPhone, guardianId, matches);
    await updateConversationState(supabase, guardianPhone, "RESCHEDULE_SELECT", {
      context: { awaiting: "appointment_choice", candidates: matches } satisfies RescheduleContext,
    });
    return;
  }

  if (context.awaiting === "confirm_appointment") {
    const pending = context.pending_appointment;
    if (!pending) {
      const body = texts.couldNotIdentifyAppointmentText();
      await sendAndLog(supabase, guardianId, "bot_reschedule_error", body, () =>
        sendTextMessage({ to: guardianPhone, body })
      );
      await updateConversationState(supabase, guardianPhone, "MENU", { context: {} });
      return;
    }

    const answer = selection.text.trim().toLowerCase();
    if (answer.startsWith("s")) {
      await finishReschedule(supabase, guardianPhone, guardianId, pending);
      return;
    }
    if (answer.startsWith("n")) {
      const body = texts.couldNotIdentifyAppointmentText();
      await sendAndLog(supabase, guardianId, "bot_reschedule_error", body, () =>
        sendTextMessage({ to: guardianPhone, body })
      );
      await updateConversationState(supabase, guardianPhone, "MENU", { context: {} });
      return;
    }

    const notUnderstood = texts.notUnderstoodYesNoText();
    await sendAndLog(supabase, guardianId, "bot_not_understood", notUnderstood, () =>
      sendTextMessage({ to: guardianPhone, body: notUnderstood })
    );
    const body = texts.confirmAppointmentText(pending.patient_name, formatWhen(new Date(pending.scheduled_at)));
    await sendAndLog(supabase, guardianId, "bot_reschedule_confirm", body, () =>
      sendTextMessage({ to: guardianPhone, body })
    );
  }
}

// --- helpers --------------------------------------------------------------

async function presentCandidates(
  supabase: SupabaseClient,
  guardianPhone: string,
  guardianId: string | null,
  candidates: AppointmentCandidate[]
): Promise<void> {
  if (candidates.length === 0) {
    const body = texts.rescheduleNoAppointmentsText();
    await sendAndLog(supabase, guardianId, "bot_reschedule_no_appointments", body, () =>
      sendTextMessage({ to: guardianPhone, body })
    );
    await updateConversationState(supabase, guardianPhone, "MENU", { context: {} });
    return;
  }

  if (candidates.length <= 3) {
    await sendAppointmentChoice(supabase, guardianPhone, guardianId, candidates);
    await updateConversationState(supabase, guardianPhone, "RESCHEDULE_SELECT", {
      context: { awaiting: "appointment_choice", candidates } satisfies RescheduleContext,
    });
    return;
  }

  const body = texts.askBirthdateText();
  await sendAndLog(supabase, guardianId, "bot_reschedule_ask_birthdate", body, () =>
    sendTextMessage({ to: guardianPhone, body })
  );
  // Guarda a lista completa no contexto — a busca por data de nascimento
  // filtra em memória, sem precisar consultar o banco de novo.
  await updateConversationState(supabase, guardianPhone, "RESCHEDULE_SELECT", {
    context: { awaiting: "birthdate_search", candidates } satisfies RescheduleContext,
  });
}

async function sendAppointmentChoice(
  supabase: SupabaseClient,
  guardianPhone: string,
  guardianId: string | null,
  candidates: AppointmentCandidate[]
): Promise<void> {
  const body = texts.appointmentChoiceBodyText("remarcar");
  await sendAndLog(supabase, guardianId, "bot_reschedule_choice", body, () =>
    sendInteractiveListMessage({
      to: guardianPhone,
      bodyText: body,
      buttonText: "Escolher opção",
      sections: texts.appointmentListSections(candidates, "reschedule"),
    })
  );
}

async function finishReschedule(
  supabase: SupabaseClient,
  guardianPhone: string,
  guardianId: string | null,
  appointment: AppointmentCandidate
): Promise<void> {
  if (!guardianId) {
    await sendRescheduleLinkError(supabase, guardianPhone, guardianId);
    return;
  }

  const expiresAt = new Date(Date.now() + 30 * 60_000).toISOString();
  const { data: link, error } = await supabase
    .from("booking_links")
    .insert({
      guardian_id: guardianId,
      patient_id: appointment.patient_id,
      clinic_location_id: appointment.clinic_location_id,
      appointment_type: appointment.appointment_type,
      exam_type_id: appointment.exam_type_id,
      mode: "reschedule",
      appointment_id: appointment.id,
      guardian_phone: guardianPhone,
      expires_at: expiresAt,
    })
    .select("id")
    .single();

  if (error || !link) {
    console.error("[whatsapp bot] erro ao criar booking_link de remarcação:", error?.message);
    await sendRescheduleLinkError(supabase, guardianPhone, guardianId);
    return;
  }

  const url = buildAppUrl(`/agendar/${link.id}`);
  const body = texts.rescheduleLinkText(appointment.patient_name, url);
  await sendAndLog(supabase, guardianId, "bot_reschedule_link", body, () =>
    sendTextMessage({ to: guardianPhone, body })
  );
  await updateConversationState(supabase, guardianPhone, "MENU", { context: {} });
}

async function sendRescheduleLinkError(
  supabase: SupabaseClient,
  guardianPhone: string,
  guardianId: string | null
): Promise<void> {
  const body = texts.rescheduleLinkErrorText();
  await sendAndLog(supabase, guardianId, "bot_reschedule_link_error", body, () =>
    sendTextMessage({ to: guardianPhone, body })
  );
  await updateConversationState(supabase, guardianPhone, "MENU", { context: {} });
}
