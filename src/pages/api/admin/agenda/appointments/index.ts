import type { APIRoute } from "astro";
import { createClient } from "../../../../../lib/supabase/server";
import { createEvent } from "../../../../../lib/google/calendar";
import { getAvailableSlotsForDate, type AppointmentType } from "../../../../../lib/scheduling/getAvailableSlotsForDate";
import { resolveClinicLocationIds, type LocationCategory } from "../../../../../lib/scheduling/resolveClinicLocationIds";
import { sendAppointmentConfirmation } from "../../../../../lib/whatsapp/notifications";

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const formData = await request.formData();
  const patientId = formData.get("patient_id")?.toString();
  const locationCategoryRaw = formData.get("location_category")?.toString();
  const examTypeId = formData.get("exam_type_id")?.toString();
  const date = formData.get("date")?.toString();
  const appointmentTypeRaw = formData.get("appointment_type")?.toString();
  // O rádio de horário carrega "<iso>|<clinicLocationId>" — o local físico
  // específico já vem decidido pelo horário escolhido; revalidamos contra a
  // lista recalculada no servidor e usamos o clinicLocationId QUE ELA devolve.
  const startParam = formData.get("start")?.toString();
  const startIso = startParam?.split("|")[0];

  const appointmentType: AppointmentType | null =
    appointmentTypeRaw === "first_visit" || appointmentTypeRaw === "return_visit" || appointmentTypeRaw === "exam"
      ? appointmentTypeRaw
      : null;
  const isExam = appointmentType === "exam";
  const locationCategory: LocationCategory = locationCategoryRaw === "home_visit" ? "home_visit" : "clinic";

  const back = (error: string) =>
    isExam
      ? redirect(`/admin/agenda/marcar-exame?exam_type_id=${examTypeId ?? ""}&date=${date ?? ""}&error=${error}`)
      : redirect(
          `/admin/agenda/marcar?location_category=${locationCategory}&date=${date ?? ""}&appointment_type=${appointmentType ?? "first_visit"}&error=${error}`
        );

  if (!patientId || !date || !startIso || !appointmentType || (isExam && !examTypeId)) {
    return back("1");
  }

  const supabase = createClient(request, cookies);

  let clinicLocationIds: string[];
  let examDurationMinutes: number | undefined;
  if (isExam) {
    const { data: examType } = await supabase
      .from("exam_types")
      .select("duration_minutes")
      .eq("id", examTypeId)
      .maybeSingle();
    if (!examType) return back("1");
    examDurationMinutes = examType.duration_minutes;
    const { data: examLocation } = await supabase
      .from("clinic_locations")
      .select("id")
      .eq("type", "exam")
      .eq("is_active", true)
      .maybeSingle();
    clinicLocationIds = examLocation ? [examLocation.id] : [];
  } else {
    clinicLocationIds = await resolveClinicLocationIds(supabase, locationCategory);
  }

  const [{ data: settings }, slots] = await Promise.all([
    supabase.from("appointment_settings").select("*").eq("id", 1).single(),
    getAvailableSlotsForDate({ supabase, clinicLocationIds, date, appointmentType, examDurationMinutes }),
  ]);

  if (!settings) {
    return back("1");
  }

  const matchedSlot = slots.find((slot) => slot.start.toISOString() === startIso);
  if (!matchedSlot) {
    return back("slot_taken");
  }
  const clinicLocationId = matchedSlot.clinicLocationId;

  const durationMinutes = isExam
    ? (examDurationMinutes ?? settings.default_appointment_duration_minutes)
    : appointmentType === "return_visit"
      ? settings.default_return_visit_duration_minutes
      : settings.default_appointment_duration_minutes;

  const startDate = matchedSlot.start;
  const endDate = new Date(startDate.getTime() + durationMinutes * 60_000);

  const { data: patient } = await supabase
    .from("patients")
    .select("full_name, guardians ( id, full_name, phone )")
    .eq("id", patientId)
    .single();

  if (!patient) {
    return back("1");
  }

  // Consulta/exame são jornadas separadas (set/2026): consulta/retorno
  // bloqueia só contra outra consulta/retorno futura; exame bloqueia só
  // contra o MESMO tipo de exame futuro — permite consulta e exame
  // simultâneos (mesma regra já usada no bot/`confirmar.ts`).
  let duplicateQuery = supabase
    .from("appointments")
    .select("id")
    .eq("patient_id", patientId)
    .in("status", ["scheduled", "confirmed"])
    .gt("scheduled_at", new Date().toISOString());

  duplicateQuery = isExam
    ? duplicateQuery.eq("appointment_type", "exam").eq("exam_type_id", examTypeId ?? "")
    : duplicateQuery.in("appointment_type", ["first_visit", "return_visit"]);

  const { data: existingFutureAppointment } = await duplicateQuery.limit(1).maybeSingle();

  if (existingFutureAppointment) {
    return back("patient_already_scheduled");
  }

  const { data: location } = await supabase
    .from("clinic_locations")
    .select("type, address, price_first_visit_cents")
    .eq("id", clinicLocationId)
    .single();

  const { data: examType } = isExam
    ? await supabase.from("exam_types").select("name, price_cents").eq("id", examTypeId).maybeSingle()
    : { data: null };

  const typeLabel = isExam ? (examType?.name ?? "Exame") : appointmentType === "return_visit" ? "Retorno" : "Consulta";
  const locationLabel = location?.type === "clinic" ? "Consultório" : location?.type === "exam" ? "Exames" : "Domiciliar";

  const { data: newAppointment, error: insertError } = await supabase
    .from("appointments")
    .insert({
      patient_id: patientId,
      clinic_location_id: clinicLocationId,
      scheduled_at: startDate.toISOString(),
      duration_minutes: durationMinutes,
      appointment_type: appointmentType,
      exam_type_id: isExam ? examTypeId : null,
      status: "scheduled",
      booking_channel: "admin",
    })
    .select("id")
    .single();

  if (insertError || !newAppointment) {
    return back("1");
  }

  const guardian = (patient.guardians ?? null) as unknown as {
    id: string;
    full_name: string;
    phone: string;
  } | null;

  const event = await createEvent({
    summary: `${typeLabel} — ${patient.full_name}${guardian ? ` (resp. ${guardian.full_name})` : ""}`,
    description: `Tel: ${guardian?.phone ?? "—"} | Tipo: ${typeLabel} | Local: ${locationLabel}`,
    start: startDate.toISOString(),
    end: endDate.toISOString(),
    appointmentId: newAppointment.id,
  });

  await supabase.from("appointments").update({ google_event_id: event.id }).eq("id", newAppointment.id);

  // Confirmação por WhatsApp (Fase 3a) — melhor esforço: uma falha aqui não
  // pode invalidar a consulta já criada no Supabase e no Calendar. Exame
  // fica pendente do template `exame_confirmado` (ainda não submetido à
  // Meta — ver plano, Fase 6).
  if (guardian?.phone && !isExam) {
    await sendAppointmentConfirmation({
      supabase,
      appointmentId: newAppointment.id,
      guardianId: guardian.id,
      guardianPhone: guardian.phone,
      patientName: patient.full_name,
      scheduledAt: startDate,
      locationLabel,
      locationAddress: location?.address ?? null,
      // Retorno não tem valor próprio — está incluso no valor da consulta
      // anterior (decisão do cliente); `null` aciona esse texto na notificação.
      priceCents: appointmentType === "return_visit" ? null : location?.price_first_visit_cents,
    });
  }

  return redirect(`/admin/agenda?date=${date}`);
};
