// Case 1 · Agendar (Fase 3b) — estados BOOK_LOCATION, BOOK_PATIENT_SELECT e
// BOOK_PATIENT_NEW da máquina de estados do bot. A modalidade (consulta ou
// retorno) não é mais perguntada aqui — "Agendar consulta" e "Agendar
// retorno" são opções separadas do menu principal (ver router.ts), que já
// chamam `startBooking` com o `appointmentType` decidido.
//
// Ao final (criança identificada ou cadastrada), gera uma linha em
// `booking_links` e envia o link de `/agendar/[token]` — a escolha de
// data/horário e a gravação da consulta em si acontecem na página, não
// aqui (ver "Agendamento e remarcação via página web" no plano).

import type { SupabaseClient } from "@supabase/supabase-js";
import { sendInteractiveListMessage, sendTextMessage } from "../client";
import { formatWhen } from "../formatDateTime";
import {
  buildAppUrl,
  formatBirthdateLabel,
  parseBirthdateInput,
  resolveByListOrDigit,
  sendAndLog,
  updateConversationState,
  type Selection,
} from "./shared";
import * as texts from "./messages";

export const BOOKING_STATES: ReadonlySet<string> = new Set([
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

export interface BookingContext {
  appointment_type?: "first_visit" | "return_visit" | "exam";
  // Exame: local único, resolvido direto (exam.ts) — clinic_location_id já
  // é o id real do local type='exam'.
  // Consulta/retorno: pode haver mais de um consultório físico type='clinic'
  // (2 endereços, set/2026) — aqui só se escolhe a CATEGORIA
  // ("clinic"/"home_visit"), nunca um endereço específico; a data/horário
  // escolhidos na página é que decidem qual consultório físico atende (ver
  // resolveClinicLocationIds.ts e "Backlog futuro" no plano).
  clinic_location_id?: string;
  location_category?: "clinic" | "home_visit";
  clinic_location_label?: string;
  // Só preenchidos quando appointment_type === "exam" (case 6 · Marcar
  // exame, ver exam.ts) — carregados até finishBookingWithPatient para
  // gravar em booking_links e compor a mensagem do link.
  exam_type_id?: string;
  exam_type_name?: string;
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
  // Data de nascimento já coletada antes de chegar em "new_patient_name"
  // (veio de uma busca por duplicidade) — evita perguntar de novo em
  // "new_patient_birthdate".
  known_birthdate?: string;
  // Diferencia o texto do estado "birthdate_search" quando há mais de uma
  // criança com a mesma data: desambiguar entre várias crianças com
  // consulta futura (texto padrão) vs. checagem de duplicidade ao
  // cadastrar uma criança nova (texto dedicado).
  birthdate_search_reason?: "duplicate_check";
}

// MENU opção 1 ("Agendar consulta") ou 2 ("Agendar retorno") → busca os
// locais de atendimento e já pergunta o local (a modalidade vem escolhida
// do próprio menu principal, não é mais perguntada aqui).
export async function startBooking(
  supabase: SupabaseClient,
  guardianPhone: string,
  guardianId: string | null,
  appointmentType: "first_visit" | "return_visit"
): Promise<void> {
  const { data: locationRows } = await supabase
    .from("clinic_locations")
    .select("type")
    .eq("is_active", true)
    .neq("type", "exam");

  // Categoria, não endereço específico — ver BookingContext.location_category.
  const types = new Set((locationRows ?? []).map((loc) => loc.type));
  const options: LocationOption[] = [];
  if (types.has("clinic")) options.push({ id: "clinic", label: "Consultório" });
  if (types.has("home_visit")) options.push({ id: "home_visit", label: "Atendimento domiciliar" });

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
    location_category: match.id as "clinic" | "home_visit",
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
//
// Exportada porque o case 6 · Marcar exame (exam.ts) entra direto neste
// estado depois de escolher o tipo de exame — a identificação do paciente
// é idêntica à do case 1 · Agendar, só muda o que acontece ao final
// (gerar booking_links com appointment_type='exam' em vez de first_visit/
// return_visit, feito em finishBookingWithPatient a partir do context).
export async function enterPatientSelect(
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

  // Consulta/exame são jornadas separadas (pedido do cliente, set/2026): ao
  // agendar consulta, só lista crianças com CONSULTA futura marcada; ao
  // marcar exame, só lista crianças com EXAME futuro marcado — nunca mistura.
  const appointmentTypeFilter =
    context.appointment_type === "exam" ? ["exam"] : ["first_visit", "return_visit"];

  const nowIso = new Date().toISOString();
  const { data: rows } = await supabase
    .from("patients")
    .select("id, full_name, appointments!inner(status, scheduled_at, appointment_type)")
    .eq("guardian_id", guardianId)
    .eq("is_active", true)
    .in("appointments.status", ["scheduled", "confirmed"])
    .in("appointments.appointment_type", appointmentTypeFilter)
    .gt("appointments.scheduled_at", nowIso);

  const candidates = dedupePatients(rows ?? []);

  if (candidates.length === 0) {
    await beginNewPatientRegistration(supabase, guardianPhone, guardianId, context);
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
  candidates: PatientCandidate[],
  bodyTextOverride?: string
): Promise<void> {
  const body = bodyTextOverride ?? texts.patientChoiceBodyText();
  await sendAndLog(supabase, guardianId, "bot_book_patient_choice", body, () =>
    sendInteractiveListMessage({
      to: guardianPhone,
      bodyText: body,
      buttonText: "Escolher opção",
      sections: texts.patientChoiceSections(candidates),
    })
  );
}

// Antes de cadastrar uma criança nova para um responsável já existente,
// pergunta a data de nascimento e verifica se já existe alguma criança com
// essa data cadastrada para esse responsável (não só as com consulta
// futura) — evita duplicar o cadastro de uma criança já existente com o
// nome digitado de um jeito ligeiramente diferente (achado testando com
// número real: "Mateus Carvalho" x "Mateus Carvalho de Sousa"). Um
// responsável sendo cadastrado agora pela primeira vez (telefone novo)
// não pode ter outra criança cadastrada, então pula direto para o nome.
async function beginNewPatientRegistration(
  supabase: SupabaseClient,
  guardianPhone: string,
  guardianId: string | null,
  context: BookingContext
): Promise<void> {
  if (!guardianId) {
    await askNewPatientName(supabase, guardianPhone, guardianId, context);
    return;
  }

  const body = texts.askBirthdateForDuplicateCheckText();
  await sendAndLog(supabase, guardianId, "bot_book_ask_birthdate", body, () =>
    sendTextMessage({ to: guardianPhone, body })
  );
  await updateConversationState(supabase, guardianPhone, "BOOK_PATIENT_SELECT", {
    context: {
      ...context,
      awaiting: "birthdate_search",
      birthdate_search_reason: "duplicate_check",
    } satisfies BookingContext,
  });
}

async function askNewPatientName(
  supabase: SupabaseClient,
  guardianPhone: string,
  guardianId: string | null,
  context: BookingContext,
  knownBirthdate?: string
): Promise<void> {
  const body = texts.askNewPatientNameText();
  await sendAndLog(supabase, guardianId, "bot_book_ask_patient_name", body, () =>
    sendTextMessage({ to: guardianPhone, body })
  );
  const cleanContext: BookingContext = {
    appointment_type: context.appointment_type,
    clinic_location_id: context.clinic_location_id,
    location_category: context.location_category,
    clinic_location_label: context.clinic_location_label,
    exam_type_id: context.exam_type_id,
    exam_type_name: context.exam_type_name,
    awaiting: "new_patient_name",
    known_birthdate: knownBirthdate,
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
      // Se essa lista veio de uma busca por data de nascimento (gêmeos ou
      // checagem de duplicidade), a data já é conhecida — não pergunta de
      // novo. Se veio da lista original de crianças com consulta futura,
      // ainda não sabemos a data — inicia a checagem de duplicidade.
      if (context.known_birthdate) {
        await askNewPatientName(supabase, guardianPhone, guardianId, context, context.known_birthdate);
      } else {
        await beginNewPatientRegistration(supabase, guardianPhone, guardianId, context);
      }
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
      await askNewPatientName(supabase, guardianPhone, guardianId, context, isoBirthdate);
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
    const bodyTextOverride =
      context.birthdate_search_reason === "duplicate_check" ? texts.birthdateMatchChoiceBodyText() : undefined;
    await sendPatientChoice(supabase, guardianPhone, guardianId, matches, bodyTextOverride);
    await updateConversationState(supabase, guardianPhone, "BOOK_PATIENT_SELECT", {
      context: {
        ...context,
        awaiting: "patient_choice",
        patient_candidates: matches,
        known_birthdate: isoBirthdate,
      } satisfies BookingContext,
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
      await askNewPatientName(supabase, guardianPhone, guardianId, context, pending.birthdate);
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

    // Data de nascimento já coletada na checagem de duplicidade — não
    // pergunta de novo, cadastra direto.
    if (context.known_birthdate) {
      await createPatientAndFinishBooking(supabase, guardianPhone, guardianId, context, text, context.known_birthdate);
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

    const patientName = context.new_patient_name ?? "Paciente";
    await createPatientAndFinishBooking(supabase, guardianPhone, guardianId, context, patientName, isoBirthdate);
  }
}

// Cadastra o responsável (se ainda não existir) e a criança, e finaliza o
// agendamento com o paciente recém-criado. Compartilhado pelos dois
// caminhos que chegam a um cadastro novo: telefone novo (pergunta nome e
// depois data de nascimento) e responsável já existente com a data de
// nascimento coletada antes, na checagem de duplicidade.
async function createPatientAndFinishBooking(
  supabase: SupabaseClient,
  guardianPhone: string,
  guardianId: string | null,
  context: BookingContext,
  patientName: string,
  isoBirthdate: string
): Promise<void> {
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

// --- finalização: gera e envia o link de `/agendar/[token]` --------------

async function finishBookingWithPatient(
  supabase: SupabaseClient,
  guardianPhone: string,
  guardianId: string | null,
  context: BookingContext,
  patientId: string,
  patientName: string
): Promise<void> {
  const isExam = context.appointment_type === "exam";
  const hasLocation = isExam ? !!context.clinic_location_id : !!context.location_category;

  if (!guardianId || !hasLocation || !context.appointment_type) {
    console.error("[whatsapp bot] contexto de agendamento incompleto ao gerar o link:", context);
    await sendBookingLinkError(supabase, guardianPhone, guardianId);
    return;
  }

  // Evita gerar um link que só falharia depois, na confirmação da página
  // (mesma trava já usada lá em `/agendar/[token]/confirmar` e no admin) —
  // pode acontecer ao escolher, pela busca de data de nascimento, uma
  // criança que já tem consulta futura marcada (achado em teste real: a
  // lista de "outra criança" não é filtrada por consulta futura, diferente
  // da lista inicial de até 3 candidatos).
  //
  // Consulta/exame são jornadas separadas (pedido do cliente, set/2026): um
  // paciente pode ter uma consulta E um exame futuros ao mesmo tempo — só
  // não pode ter dois agendamentos futuros do MESMO tipo (duas consultas/
  // retornos, ou o mesmo tipo de exame duas vezes).
  let duplicateQuery = supabase
    .from("appointments")
    .select("scheduled_at")
    .eq("patient_id", patientId)
    .in("status", ["scheduled", "confirmed"])
    .gt("scheduled_at", new Date().toISOString());

  duplicateQuery =
    context.appointment_type === "exam"
      ? duplicateQuery.eq("appointment_type", "exam").eq("exam_type_id", context.exam_type_id ?? "")
      : duplicateQuery.in("appointment_type", ["first_visit", "return_visit"]);

  const { data: existingAppointment } = await duplicateQuery
    .order("scheduled_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (existingAppointment) {
    const body = texts.patientAlreadyScheduledText(
      patientName,
      formatWhen(new Date(existingAppointment.scheduled_at)),
      context.appointment_type === "exam"
    );
    await sendAndLog(supabase, guardianId, "bot_book_already_scheduled", body, () =>
      sendTextMessage({ to: guardianPhone, body })
    );
    await updateConversationState(supabase, guardianPhone, "MENU", { context: {} });
    return;
  }

  const expiresAt = new Date(Date.now() + 30 * 60_000).toISOString();
  const { data: link, error } = await supabase
    .from("booking_links")
    .insert({
      guardian_id: guardianId,
      patient_id: patientId,
      clinic_location_id: isExam ? context.clinic_location_id : null,
      location_category: isExam ? null : context.location_category,
      appointment_type: context.appointment_type,
      exam_type_id: context.exam_type_id ?? null,
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

  const url = buildAppUrl(`/agendar/${link.id}`);
  const body =
    context.appointment_type === "exam"
      ? texts.examBookingLinkText(patientName, context.exam_type_name ?? "exame", url)
      : texts.bookingLinkText(patientName, url);
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

