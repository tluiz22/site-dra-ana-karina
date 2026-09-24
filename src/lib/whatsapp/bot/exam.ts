// Case 6 · Marcar exame (Fase 6) — estado EXAM_TYPE_SELECT da máquina de
// estados do bot.
//
// Só a escolha do tipo de exame é exclusiva daqui — não há pergunta de
// local (todo exame usa o único local `clinic_locations.type='exam'') nem
// de modalidade. Depois de escolher o exame, entra direto no mesmo fluxo
// de identificação de paciente do case 1 · Agendar (`enterPatientSelect`,
// em booking.ts), reaproveitado sem alterações.

import type { SupabaseClient } from "@supabase/supabase-js";
import { sendInteractiveListMessage, sendTextMessage } from "../client";
import { resolveByListOrDigit, sendAndLog, updateConversationState, type Selection } from "./shared";
import { enterPatientSelect, type BookingContext } from "./booking";
import { filterExamTypesWithSchedule } from "../../scheduling/examScheduleAvailability";
import * as texts from "./messages";

export const EXAM_STATES: ReadonlySet<string> = new Set(["EXAM_TYPE_SELECT"]);

interface ExamTypeCandidate {
  id: string;
  name: string;
}

interface ExamContext {
  exam_type_candidates?: ExamTypeCandidate[];
}

// MENU opção "Marcar exame" → lista os exam_types ativos com disponibilidade
// cadastrada (regra geral da Fase 11: sem dia/horário cadastrado, o exame
// nem aparece pra escolher).
export async function startExam(
  supabase: SupabaseClient,
  guardianPhone: string,
  guardianId: string | null
): Promise<void> {
  const { data: allExamTypes } = await supabase
    .from("exam_types")
    .select("id, name, scheduling_mode")
    .eq("is_active", true)
    .order("name");

  const examTypes = await filterExamTypesWithSchedule(supabase, allExamTypes ?? []);

  if (!examTypes.length) {
    const body = texts.noExamTypesAvailableText();
    await sendAndLog(supabase, guardianId, "bot_exam_no_types", body, () =>
      sendTextMessage({ to: guardianPhone, body })
    );
    await updateConversationState(supabase, guardianPhone, "WELCOME", { context: {} });
    return;
  }

  await sendExamTypeQuestion(supabase, guardianPhone, guardianId, examTypes);
  const context: ExamContext = { exam_type_candidates: examTypes };
  await updateConversationState(supabase, guardianPhone, "EXAM_TYPE_SELECT", { context });
}

async function sendExamTypeQuestion(
  supabase: SupabaseClient,
  guardianPhone: string,
  guardianId: string | null,
  examTypes: ExamTypeCandidate[]
): Promise<void> {
  const body = texts.examTypeChoiceBodyText();
  await sendAndLog(supabase, guardianId, "bot_exam_type_choice", body, () =>
    sendInteractiveListMessage({
      to: guardianPhone,
      bodyText: body,
      buttonText: "Escolher opção",
      sections: texts.examTypeSections(examTypes),
    })
  );
}

export async function handleExamState(
  supabase: SupabaseClient,
  guardianPhone: string,
  guardianId: string | null,
  rawContext: Record<string, unknown>,
  selection: Selection
): Promise<void> {
  const context = rawContext as ExamContext;
  const candidates = context.exam_type_candidates ?? [];
  const match = resolveByListOrDigit(selection, candidates, (c) => `exam_type_${c.id}`);

  if (!match) {
    const body = texts.notUnderstoodText();
    await sendAndLog(supabase, guardianId, "bot_not_understood", body, () =>
      sendTextMessage({ to: guardianPhone, body })
    );
    await sendExamTypeQuestion(supabase, guardianPhone, guardianId, candidates);
    return;
  }

  const { data: examLocation } = await supabase
    .from("clinic_locations")
    .select("id, name")
    .eq("type", "exam")
    .eq("is_active", true)
    .maybeSingle();

  if (!examLocation) {
    console.error("[whatsapp bot] nenhum clinic_locations com type='exam' ativo");
    const body = texts.noExamTypesAvailableText();
    await sendAndLog(supabase, guardianId, "bot_exam_no_types", body, () =>
      sendTextMessage({ to: guardianPhone, body })
    );
    await updateConversationState(supabase, guardianPhone, "WELCOME", { context: {} });
    return;
  }

  const bookingContext: BookingContext = {
    appointment_type: "exam",
    clinic_location_id: examLocation.id,
    clinic_location_label: examLocation.name,
    exam_type_id: match.id,
    exam_type_name: match.name,
  };
  await updateConversationState(supabase, guardianPhone, "BOOK_PATIENT_SELECT", { context: bookingContext });
  await enterPatientSelect(supabase, guardianPhone, guardianId, bookingContext);
}
