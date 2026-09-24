import type { APIRoute } from "astro";
import { createClient } from "../../../../../lib/supabase/server";

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const formData = await request.formData();
  const examTypeId = formData.get("exam_type_id")?.toString();
  const weekday = formData.get("weekday")?.toString();
  const startTime = formData.get("start_time")?.toString();
  const endTime = formData.get("end_time")?.toString();
  const capacityRaw = formData.get("capacity")?.toString();

  if (!examTypeId || !weekday || !startTime || !endTime) {
    return redirect("/admin/configuracoes?error=1");
  }

  if (startTime >= endTime) {
    return redirect("/admin/configuracoes?error=invalid_range");
  }

  const supabase = createClient(request, cookies);

  const { data: examType, error: examTypeError } = await supabase
    .from("exam_types")
    .select("scheduling_mode")
    .eq("id", examTypeId)
    .maybeSingle();

  if (examTypeError || !examType) {
    return redirect("/admin/configuracoes?error=1");
  }

  // Vagas só existe (e é obrigatório) pra exame em modo grupo — o campo vem
  // desabilitado na tela pra exame individual, então nem chega no formData.
  const isGroup = examType.scheduling_mode === "group";
  const capacity = capacityRaw ? Number(capacityRaw) : NaN;

  if (isGroup && (!Number.isFinite(capacity) || capacity < 1)) {
    return redirect("/admin/configuracoes?error=1");
  }

  // Checa contra TODOS os exames nesse dia da semana, não só o mesmo exame —
  // a médica é uma pessoa só, não dá pra fazer dois exames diferentes ao
  // mesmo tempo (achado do cliente: cadastrar FeNO e Prick Test no mesmo
  // horário passava sem aviso nenhum).
  const { data: existingWindows, error: fetchError } = await supabase
    .from("exam_type_availability_windows")
    .select("start_time, end_time")
    .eq("weekday", Number(weekday))
    .eq("is_active", true);

  if (fetchError) {
    return redirect("/admin/configuracoes?error=1");
  }

  const overlaps = existingWindows?.some((window) => {
    const existingStart = window.start_time.slice(0, 5);
    const existingEnd = window.end_time.slice(0, 5);
    return startTime < existingEnd && endTime > existingStart;
  });

  if (overlaps) {
    return redirect("/admin/configuracoes?error=overlap");
  }

  const { error } = await supabase.from("exam_type_availability_windows").insert({
    exam_type_id: examTypeId,
    weekday: Number(weekday),
    start_time: startTime,
    end_time: endTime,
    capacity: isGroup ? capacity : null,
  });

  if (error) {
    return redirect("/admin/configuracoes?error=1");
  }

  return redirect("/admin/configuracoes");
};
