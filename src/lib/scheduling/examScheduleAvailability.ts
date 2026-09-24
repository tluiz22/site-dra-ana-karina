import type { SupabaseClient } from "@supabase/supabase-js";

export interface ExamTypeForScheduleCheck {
  id: string;
}

/**
 * Filtra exam_types pra só os que têm disponibilidade cadastrada — regra
 * geral da Fase 11: se o exame não tem dia/horário cadastrado, ele não deve
 * aparecer como opção pra marcar (nem no bot, nem no admin), pra não levar o
 * paciente/secretária até a tela de marcação só pra descobrir que não há
 * horário. Individual e grupo usam a mesma tabela (`exam_type_availability_windows`,
 * uma linha por exame) — cada exame tem sua própria disponibilidade, não
 * compartilha com nenhum local (decisão revista, ver plano).
 */
export async function filterExamTypesWithSchedule<T extends ExamTypeForScheduleCheck>(
  supabase: SupabaseClient,
  examTypes: T[]
): Promise<T[]> {
  if (!examTypes.length) return [];

  const { data: windows } = await supabase
    .from("exam_type_availability_windows")
    .select("exam_type_id")
    .in(
      "exam_type_id",
      examTypes.map((exam) => exam.id)
    )
    .eq("is_active", true);

  const examTypeIdsWithWindows = new Set((windows ?? []).map((window) => window.exam_type_id));

  return examTypes.filter((exam) => examTypeIdsWithWindows.has(exam.id));
}
