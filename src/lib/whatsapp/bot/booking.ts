// Case 1 · Agendar (Fase 3b) — estados BOOK_MODALITY, BOOK_LOCATION,
// BOOK_PATIENT_SELECT e BOOK_PATIENT_NEW da máquina de estados do bot.
//
// Ao final (criança identificada ou cadastrada), gera uma linha em
// `booking_links` e envia o link de `/agendar/[token]` — a escolha de
// data/horário e a gravação da consulta em si acontecem na página, não
// aqui (ver "Agendamento e remarcação via página web" no plano).

import type { SupabaseClient } from "@supabase/supabase-js";
import { sendInteractiveListMessage, sendTextMessage } from "../client";
import {
  formatBirthdateLabel,
  matchesOption,
  parseBirthdateInput,
  resolveByListOrDigit,
  resolveSiteUrl,
  sendAndLog,
  updateConversationState,
  type Selection,
} from "./shared";
import * as texts from "./messages";

export const BOOKING_STATES: ReadonlySet<string> = new Set([
  "BOOK_MODALITY",
  "BOOK_LOCATION",
  "BOOK_PATIENT_SELECT",
  "BOOK_PATIENT_NEW",
]);

interface LocationOption {
  id: string;
  label: string;
}

interface PatientCandidate {
  id: string;
  full_name: string;
}

interface PendingPatient {
  id: string;
  full_name: string;
  birthdate: string;
}

interface BookingContext {
  appointment_type?: "first_visit" | "return_visit";
  clinic_location_id?: string;
  clinic_location_label?: string;
  location_options?: LocationOption[];
  awaiting?:
    | "patient_choice"
    | "birthdate_search"
    | "confirm_patient"
    | "new_guardian_name"
    | "new_patient_name"
    | "new_patient_birthdate";
  patient_candidates?: PatientCandidate[];
  pending_patient?: PendingPatient;
  new_guardian_name?: string;
  new_patient_name?: string;
}

// MENU opção 1 → primeira pergunta do fluxo (modalidade).
export async function startBooking(
  supabase: SupabaseClient,
  guardianPhone: string,
  guardianId: string | null
): Promise<void> {
  await sendModalityQuestion(supabase, guardianPhone, guardianId);
  await updateConversationState(supabase, guardianPhone, "BOOK_MODALITY", { context: {} });
}

export async function handleBookingState(
  supabase: SupabaseClient,
  guardianPhone: string,
  guardianId: string | null,
  state: string,
  rawContext: Record<string, unknown>,
  selection: Selection
): Promise<void> {
  const context = rawContext as BookingContext;

  switch (state) {
    case "BOOK_MODALITY":
      await handleModality(supabase, guardianPhone, guardianId, selection);
      return;
    case "BOOK_LOCATION":
      await handleLocation(supabase, guardianPhone, guardianId, context, selection);
      return;
    case "BOOK_PATIENT_SELECT":
      await handlePatientSelect(supabase, guardianPhone, guardianId, context, selection);
      return;
    case "BOOK_PATIENT_NEW":
      await handlePatientNew(supabase, guardianPhone, guardianId, context, selection);
      return;
  }
}

// --- BOOK_MODALITY ------------------------------------------------------

async function sendModalityQuestion(
  supabase: SupabaseClient,
  guardianPhone: string,
  guardianId: string | null
): Promise<void> {
  const body = texts.modalityBodyText();
  await sendAndLog(supabase, guardianId, "bot_book_modality", body, () =>
    sendInteractiveListMessage({
      to: guardianPhone,
      bodyText: body,
      buttonText: "Escolher opção",
      sections: texts.modalitySections(),
    })
  );
}

async function handleModality(
  supabase: SupabaseClient,
  guardianPhone: string,
  guardianId: string | null,
  selection: Selection
): Promise<void> {
  let appointmentType: "first_visit" | "return_visit" | null = null;
  if (matchesOption(selection, "1", texts.MODALITY_LIST_ID.firstVisit)) appointmentType = "first_visit";
  else if (matchesOption(selection, "2", texts.MODALITY_LIST_ID.returnVisit)) appointmentType = "return_visit";

  if (!appointmentType) {
    const body = texts.notUnderstoodText();
    await sendAndLog(supabase, guardianId, "bot_not_understood", body, () =>
      sendTextMessage({ to: guardianPhone, body })
    );
    await sendModalityQuestion(supabase, guardianPhone, guardianId);
    return;
  }

  const { data: locationRows } = await supabase
    .from("clinic_locations")
    .select("id, name, type")
    .eq("is_active", true)
    .order("type");

  const options: LocationOption[] = (locationRows ?? []).map((loc) => ({
    id: loc.id,
    label: loc.type === "home_visit" ? "Atendimento domiciliar" : loc.name,
  }));

  if (options.length === 0) {
    const body = texts.noLocationAvailableText();
    await sendAndLog(supabase, guardianId, "bot_book_no_location", body, () =>
      sendTextMessage({ to: guardianPhone, body })
    );
    await updateConversationState(supabase, guardianPhone, "MENU", { context: {} });
    return;
  }

  await sendLocationQuestion(supabase, guardianPhone, guardianId, options);
  const context: BookingContext = { appointment_type: appointmentType, location_options: options };
  await updateConversationState(supabase, guardianPhone, "BOOK_LOCATION", { context });
}

// --- BOOK_LOCATION ------------------------------------------------------

async function sendLocationQuestion(
  supabase: SupabaseClient,
  guardianPhone: string,
  guardianId: string | null,
  options: LocationOption[]
): Promise<void> {
  const body = texts.locationBodyText();
  await sendAndLog(supabase, guardianId, "bot_book_location", body, () =>
    sendInteractiveListMessage({
      to: guardianPhone,
      bodyText: body,
      buttonText: "Escolher opção",
      sections: texts.locationSections(options),
    })
  );
}

async function handleLocation(
  supabase: SupabaseClient,
  guardianPhone: string,
  guardianId: string | null,
  context: BookingContext,
  selection: Selection
): Promise<void> {
  const options = context.location_options ?? [];
  const match = resolveByListOrDigit(selection, options, (o) => `book_location_${o.id}`);

  if (!match) {
    const body = texts.notUnderstoodText();
    await sendAndLog(supabase, guardianId, "bot_not_understood", body, () =>
      sendTextMessage({ to: guardianPhone, body })
    );
    await sendLocationQuestion(supabase, guardianPhone, guardianId, options);
    return;
  }

  const newContext: BookingContext = {
    appointment_type: context.appointment_type,
    clinic_location_id: match.id,
    clinic_location_label: match.label,
  };
  await updateConversationState(supabase, guardianPhone, "BOOK_PATIENT_SELECT", { context: newContext });
  await enterPatientSelect(supabase, guardianPhone, guardianId, newContext);
}

// --- BOOK_PATIENT_SELECT (identificação da criança) ----------------------

// Ao entrar neste estado, restringe a busca às crianças desse responsável
// com consulta futura já agendada — nunca lista todas (ver "Identificação
// da criança" no plano, motivado por responsáveis-convênio com dezenas ou
// centenas de crianças vinculadas ao mesmo telefone).
async function enterPatientSelect(
  supabase: SupabaseClient,
  guardianPhone: string,
  guardianId: string | null,
  context: BookingContext
): Promise<void> {
  if (!guardianId) {
    const body = texts.askGuardianNameText();
    await sendAndLog(supabase, guardianId, "bot_book_ask_guardian_name", body, () =>
      sendTextMessage({ to: guardianPhone, body })
    );
    await updateConversationState(supabase, guardianPhone, "BOOK_PATIENT_NEW", {
      context: { ...context, awaiting: "new_guardian_name" } satisfies BookingContext,
    });
    return;
  }

  const nowIso = new Date().toISOString();
  const { data: rows } = await supabase
    .from("patients")
    .select("id, full_name, appointments!inner(status, scheduled_at)")
    .eq("guardian_id", guardianId)
    .eq("is_active", true)
    .in("appointments.status", ["scheduled", "confirmed"])
    .gt("appointments.scheduled_at", nowIso);

  const candidates = dedupePatients(rows ?? []);

  if (candidates.length === 0) {
    await askNewPatientName(supabase, guardianPhone, guardianId, context);
    return;
  }

  if (candidates.length <= 3) {
    await sendPatientChoice(supabase, guardianPhone, guardianId, candidates);
    await updateConversationState(supabase, guardianPhone, "BOOK_PATIENT_SELECT", {
      context: { ...context, awaiting: "patient_choice", patient_candidates: candidates } satisfies BookingContext,
    });
    return;
  }

  const body = texts.askBirthdateText();
  await sendAndLog(supabase, guardianId, "bot_book_ask_birthdate", body, () =>
    sendTextMessage({ to: guardianPhone, body })
  );
  await updateConversationState(supabase, guardianPhone, "BOOK_PATIENT_SELECT", {
    context: { ...context, awaiting: "birthdate_search" } satisfies BookingContext,
  });
}

async function sendPatientChoice(
  supabase: SupabaseClient,
  guardianPhone: string,
  guardianId: string | null,
  candidates: PatientCandidate[]
): Promise<void> {
  const body = texts.patientChoiceBodyText();
  await sendAndLog(supabase, guardianId, "bot_book_patient_choice", body, () =>
    sendInteractiveListMessage({
      to: guardianPhone,
      bodyText: body,
      buttonText: "Escolher opção",
      sections: texts.patientChoiceSections(candidates),
    })
  );
}

async function askNewPatientName(
  supabase: SupabaseClient,
  guardianPhone: string,
  guardianId: string | null,
  context: BookingContext
): Promise<void> {
  const body = texts.askNewPatientNameText();
  await sendAndLog(supabase, guardianId, "bot_book_ask_patient_name", body, () =>
    sendTextMessage({ to: guardianPhone, body })
  );
  const cleanContext: BookingContext = {
    appointment_type: context.appointment_type,
    clinic_location_id: context.clinic_location_id,
    clinic_location_label: context.clinic_location_label,
    awaiting: "new_patient_name",
  };
  await updateConversationState(supabase, guardianPhone, "BOOK_PATIENT_NEW", { context: cleanContext });
}

async function handlePatientSelect(
  supabase: SupabaseClient,
  guardianPhone: string,
  guardianId: string | null,
  context: BookingContext,
  selection: Selection
): Promise<void> {
  if (context.awaiting === "patient_choice") {
    const candidates = context.patient_candidates ?? [];
    const isOther =
      selection.id === texts.PATIENT_NEW_LIST_ID || selection.text.trim() === String(candidates.length + 1);

    if (isOther) {
      await askNewPatientName(supabase, guardianPhone, guardianId, context);
      return;
    }

    const match = resolveByListOrDigit(selection, candidates, (c) => `book_patient_${c.id}`);
    if (!match) {
      const body = texts.notUnderstoodText();
      await sendAndLog(supabase, guardianId, "bot_not_understood", body, () =>
        sendTextMessage({ to: guardianPhone, body })
      );
      await sendPatientChoice(supabase, guardianPhone, guardianId, candidates);
      return;
    }

    await finishBookingWithPatient(supabase, guardianPhone, guardianId, context, match.id, match.full_name);
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

    const { data: matches } = await supabase
      .from("patients")
      .select("id, full_name, birthdate")
      .eq("guardian_id", guardianId as string)
      .eq("is_active", true)
      .eq("birthdate", isoBirthdate);

    if (!matches || matches.length === 0) {
      await askNewPatientName(supabase, guardianPhone, guardianId, context);
      return;
    }

    if (matches.length === 1) {
      const pending = matches[0] as PendingPatient;
      const body = texts.confirmPatientText(pending.full_name, formatBirthdateLabel(pending.birthdate));
      await sendAndLog(supabase, guardianId, "bot_book_confirm_patient", body, () =>
        sendTextMessage({ to: guardianPhone, body })
      );
      await updateConversationState(supabase, guardianPhone, "BOOK_PATIENT_SELECT", {
        context: { ...context, awaiting: "confirm_patient", pending_patient: pending } satisfies BookingContext,
      });
      return;
    }

    // Mais de uma criança com a mesma data de nascimento (ex.: gêmeos).
    await sendPatientChoice(supabase, guardianPhone, guardianId, matches);
    await updateConversationState(supabase, guardianPhone, "BOOK_PATIENT_SELECT", {
      context: { ...context, awaiting: "patient_choice", patient_candidates: matches } satisfies BookingContext,
    });
    return;
  }

  if (context.awaiting === "confirm_patient") {
    const pending = context.pending_patient;
    if (!pending) {
      await askNewPatientName(supabase, guardianPhone, guardianId, context);
      return;
    }

    const answer = selection.text.trim().toLowerCase();
    if (answer.startsWith("s")) {
      await finishBookingWithPatient(supabase, guardianPhone, guardianId, context, pending.id, pending.full_name);
      return;
    }
    if (answer.startsWith("n")) {
      await askNewPatientName(supabase, guardianPhone, guardianId, context);
      return;
    }

    const notUnderstood = texts.notUnderstoodYesNoText();
    await sendAndLog(supabase, guardianId, "bot_not_understood", notUnderstood, () =>
      sendTextMessage({ to: guardianPhone, body: notUnderstood })
    );
    const body = texts.confirmPatientText(pending.full_name, formatBirthdateLabel(pending.birthdate));
    await sendAndLog(supabase, guardianId, "bot_book_confirm_patient", body, () =>
      sendTextMessage({ to: guardianPhone, body })
    );
  }
}

// --- BOOK_PATIENT_NEW (cadastro de criança nova) --------------------------

async function handlePatientNew(
  supabase: SupabaseClient,
  guardianPhone: string,
  guardianId: string | null,
  context: BookingContext,
  selection: Selection
): Promise<void> {
  const text = selection.text.trim();

  if (context.awaiting === "new_guardian_name") {
    if (!text) {
      const body = texts.askGuardianNameText();
      await sendAndLog(supabase, guardianId, "bot_book_ask_guardian_name", body, () =>
        sendTextMessage({ to: guardianPhone, body })
      );
      return;
    }
    const body = texts.askNewPatientNameText();
    await sendAndLog(supabase, guardianId, "bot_book_ask_patient_name", body, () =>
      sendTextMessage({ to: guardianPhone, body })
    );
    await updateConversationState(supabase, guardianPhone, "BOOK_PATIENT_NEW", {
      context: { ...context, awaiting: "new_patient_name", new_guardian_name: text } satisfies BookingContext,
    });
    return;
  }

  if (context.awaiting === "new_patient_name") {
    if (!text) {
      const body = texts.askNewPatientNameText();
      await sendAndLog(supabase, guardianId, "bot_book_ask_patient_name", body, () =>
        sendTextMessage({ to: guardianPhone, body })
      );
      return;
    }
    const body = texts.askNewPatientBirthdateText();
    await sendAndLog(supabase, guardianId, "bot_book_ask_birthdate", body, () =>
      sendTextMessage({ to: guardianPhone, body })
    );
    await updateConversationState(supabase, guardianPhone, "BOOK_PATIENT_NEW", {
      context: { ...context, awaiting: "new_patient_birthdate", new_patient_name: text } satisfies BookingContext,
    });
    return;
  }

  if (context.awaiting === "new_patient_birthdate") {
    const isoBirthdate = parseBirthdateInput(text);
    if (!isoBirthdate) {
      const body = texts.invalidBirthdateText();
      await sendAndLog(supabase, guardianId, "bot_invalid_birthdate", body, () =>
        sendTextMessage({ to: guardianPhone, body })
      );
      return;
    }

    let guardianIdToUse = guardianId;
    if (!guardianIdToUse) {
      const guardianName = context.new_guardian_name ?? "Responsável";
      const { data: newGuardian, error } = await supabase
        .from("guardians")
        .insert({ full_name: guardianName, phone: guardianPhone })
        .select("id")
        .single();
      if (error || !newGuardian) {
        console.error("[whatsapp bot] erro ao cadastrar responsável:", error?.message);
        await sendBookingLinkError(supabase, guardianPhone, guardianId);
        return;
      }
      guardianIdToUse = newGuardian.id;
    }

    const patientName = context.new_patient_name ?? "Paciente";
    const { data: newPatient, error: patientError } = await supabase
      .from("patients")
      .insert({ full_name: patientName, birthdate: isoBirthdate, guardian_id: guardianIdToUse })
      .select("id")
      .single();

    if (patientError || !newPatient) {
      console.error("[whatsapp bot] erro ao cadastrar criança:", patientError?.message);
      await sendBookingLinkError(supabase, guardianPhone, guardianIdToUse);
      return;
    }

    await finishBookingWithPatient(supabase, guardianPhone, guardianIdToUse, context, newPatient.id, patientName);
  }
}

// --- finalização: gera e envia o link de `/agendar/[token]` --------------

async function finishBookingWithPatient(
  supabase: SupabaseClient,
  guardianPhone: string,
  guardianId: string | null,
  context: BookingContext,
  patientId: string,
  patientName: string
): Promise<void> {
  if (!guardianId || !context.clinic_location_id || !context.appointment_type) {
    console.error("[whatsapp bot] contexto de agendamento incompleto ao gerar o link:", context);
    await sendBookingLinkError(supabase, guardianPhone, guardianId);
    return;
  }

  const expiresAt = new Date(Date.now() + 30 * 60_000).toISOString();
  const { data: link, error } = await supabase
    .from("booking_links")
    .insert({
      guardian_id: guardianId,
      patient_id: patientId,
      clinic_location_id: context.clinic_location_id,
      appointment_type: context.appointment_type,
      mode: "create",
      guardian_phone: guardianPhone,
      expires_at: expiresAt,
    })
    .select("id")
    .single();

  if (error || !link) {
    console.error("[whatsapp bot] erro ao criar booking_link:", error?.message);
    await sendBookingLinkError(supabase, guardianPhone, guardianId);
    return;
  }

  const url = `${resolveSiteUrl()}/agendar/${link.id}`;
  const body = texts.bookingLinkText(patientName, url);
  await sendAndLog(supabase, guardianId, "bot_booking_link", body, () =>
    sendTextMessage({ to: guardianPhone, body })
  );
  await updateConversationState(supabase, guardianPhone, "MENU", { context: {} });
}

async function sendBookingLinkError(
  supabase: SupabaseClient,
  guardianPhone: string,
  guardianId: string | null
): Promise<void> {
  const body = texts.bookingLinkErrorText();
  await sendAndLog(supabase, guardianId, "bot_book_link_error", body, () =>
    sendTextMessage({ to: guardianPhone, body })
  );
  await updateConversationState(supabase, guardianPhone, "MENU", { context: {} });
}

// --- helpers --------------------------------------------------------------

function dedupePatients(
  rows: { id: string; full_name: string }[]
): PatientCandidate[] {
  const seen = new Map<string, PatientCandidate>();
  for (const row of rows) {
    if (!seen.has(row.id)) seen.set(row.id, { id: row.id, full_name: row.full_name });
  }
  return [...seen.values()];
}

