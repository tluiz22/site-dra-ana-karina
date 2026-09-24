import type { APIRoute } from "astro";
import { createClient } from "../../../../../lib/supabase/server";
import { createEvent } from "../../../../../lib/google/calendar";
import { getAvailableSlotsForDate, type AppointmentType } from "../../../../../lib/scheduling/getAvailableSlotsForDate";
import { getExamAvailableSlotsForDate } from "../../../../../lib/scheduling/getExamAvailableSlotsForDate";
import { getNextAvailableGroupDates, type AvailableGroupSession } from "../../../../../lib/scheduling/getNextAvailableGroupDates";
import { joinOrCreateGroupSessionEvent } from "../../../../../lib/scheduling/groupSessionCalendar";
import { resolveClinicLocationIds, type LocationCategory } from "../../../../../lib/scheduling/resolveClinicLocationIds";
import { buildAppointmentTypeLabel, sendAppointmentConfirmation } from "../../../../../lib/whatsapp/notifications";

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

  const { data: settings } = await supabase.from("appointment_settings").select("*").eq("id", 1).single();
  if (!settings) {
    return back("1");
  }

  let examTypeInfo: { name: string; duration_minutes: number; price_cents: number; scheduling_mode: string } | null = null;
  let clinicLocationId: string;
  let startDate: Date;
  let endDate: Date;
  let durationMinutes: number;
  let matchedSession: AvailableGroupSession | undefined;

  if (isExam) {
    const { data: fetchedExamType } = await supabase
      .from("exam_types")
      .select("name, duration_minutes, price_cents, scheduling_mode")
      .eq("id", examTypeId)
      .maybeSingle();
    if (!fetchedExamType) return back("1");
    examTypeInfo = fetchedExamType;

    const { data: examLocation } = await supabase
      .from("clinic_locations")
      .select("id")
      .eq("type", "exam")
      .eq("is_active", true)
      .maybeSingle();
    if (!examLocation) return back("1");

    if (examTypeInfo.scheduling_mode === "group") {
      // Sem freebusy do Calendar: revalida a sessão (data+horário fixo)
      // contra a capacidade recalculada agora. A trava de verdade contra
      // duas confirmações simultâneas é a RPC atômica logo abaixo — essa
      // aqui é só uma primeira checagem, mais barata.
      const sessions = await getNextAvailableGroupDates({ supabase, examTypeId: examTypeId! });
      matchedSession = sessions.find(
        (session) => new Date(`${session.date}T${session.startTime}:00-03:00`).toISOString() === startIso
      );
      if (!matchedSession) return back("slot_taken");
      clinicLocationId = examLocation.id;
      durationMinutes = examTypeInfo.duration_minutes;
      startDate = new Date(`${matchedSession.date}T${matchedSession.startTime}:00-03:00`);
      endDate = new Date(`${matchedSession.date}T${matchedSession.endTime}:00-03:00`);
    } else {
      const slots = await getExamAvailableSlotsForDate({
        supabase,
        examTypeId: examTypeId!,
        examLocationId: examLocation.id,
        date,
        examDurationMinutes: examTypeInfo.duration_minutes,
      });
      const matchedSlot = slots.find((slot) => slot.start.toISOString() === startIso);
      if (!matchedSlot) return back("slot_taken");
      clinicLocationId = matchedSlot.clinicLocationId;
      durationMinutes = examTypeInfo.duration_minutes ?? settings.default_appointment_duration_minutes;
      startDate = matchedSlot.start;
      endDate = new Date(startDate.getTime() + durationMinutes * 60_000);
    }
  } else {
    const clinicLocationIds = await resolveClinicLocationIds(supabase, locationCategory);
    const slots = await getAvailableSlotsForDate({ supabase, clinicLocationIds, date, appointmentType });
    const matchedSlot = slots.find((slot) => slot.start.toISOString() === startIso);
    if (!matchedSlot) return back("slot_taken");
    clinicLocationId = matchedSlot.clinicLocationId;
    durationMinutes =
      appointmentType === "return_visit"
        ? settings.default_return_visit_duration_minutes
        : settings.default_appointment_duration_minutes;
    startDate = matchedSlot.start;
    endDate = new Date(startDate.getTime() + durationMinutes * 60_000);
  }

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

  const typeLabel = buildAppointmentTypeLabel(appointmentType, examTypeInfo?.name);
  const locationLabel = location?.type === "clinic" ? "Consultório" : location?.type === "exam" ? "Exames" : "Domiciliar";

  let newAppointmentId: string;

  if (isExam && examTypeInfo?.scheduling_mode === "group" && matchedSession) {
    const { data: rpcAppointmentId, error: rpcError } = await supabase.rpc("book_group_exam_session", {
      p_exam_type_id: examTypeId,
      p_scheduled_at: startDate.toISOString(),
      p_patient_id: patientId,
      p_clinic_location_id: clinicLocationId,
      p_duration_minutes: durationMinutes,
      p_booking_channel: "admin",
    });

    if (rpcError || !rpcAppointmentId) {
      return back("slot_taken");
    }

    newAppointmentId = rpcAppointmentId as string;

    const eventId = await joinOrCreateGroupSessionEvent({
      supabase,
      appointmentId: newAppointmentId,
      examTypeId: examTypeId!,
      examName: examTypeInfo.name,
      capacity: matchedSession.capacity,
      startIso: startDate.toISOString(),
      endIso: endDate.toISOString(),
    });

    await supabase.from("appointments").update({ google_event_id: eventId }).eq("id", newAppointmentId);
  } else {
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

    newAppointmentId = newAppointment.id;

    const guardianForEvent = (patient.guardians ?? null) as unknown as { full_name: string; phone: string } | null;
    const event = await createEvent({
      summary: `${typeLabel} — ${patient.full_name}${guardianForEvent ? ` (resp. ${guardianForEvent.full_name})` : ""}`,
      description: `Tel: ${guardianForEvent?.phone ?? "—"} | Tipo: ${typeLabel} | Local: ${locationLabel}`,
      start: startDate.toISOString(),
      end: endDate.toISOString(),
      appointmentId: newAppointment.id,
    });

    await supabase.from("appointments").update({ google_event_id: event.id }).eq("id", newAppointment.id);
  }

  // Invalida qualquer link de agendamento ainda pendente desse paciente pro
  // mesmo tipo (ex.: de um cancelamento em massa, Fase 12) — evita que o
  // responsável use um link antigo depois que a secretária já remarcou por
  // aqui; sem isso, ele só seria barrado bem no fim do fluxo do link (mesma
  // trava de duplicidade acima), depois de já ter escolhido data/horário.
  let invalidateLinksQuery = supabase
    .from("booking_links")
    .update({ used_at: new Date().toISOString() })
    .eq("patient_id", patientId)
    .eq("mode", "create")
    .is("used_at", null);

  invalidateLinksQuery = isExam
    ? invalidateLinksQuery.eq("appointment_type", "exam").eq("exam_type_id", examTypeId ?? "")
    : invalidateLinksQuery.in("appointment_type", ["first_visit", "return_visit"]);

  await invalidateLinksQuery;

  const guardian = (patient.guardians ?? null) as unknown as {
    id: string;
    full_name: string;
    phone: string;
  } | null;

  // Confirmação por WhatsApp (Fase 3a) — melhor esforço: uma falha aqui não
  // pode invalidar a consulta já criada no Supabase e no Calendar.
  if (guardian?.phone) {
    await sendAppointmentConfirmation({
      supabase,
      appointmentId: newAppointmentId,
      guardianId: guardian.id,
      guardianPhone: guardian.phone,
      patientName: patient.full_name,
      typeLabel,
      scheduledAt: startDate,
      locationLabel,
      locationAddress: location?.address ?? null,
      // Retorno não tem valor próprio — está incluso no valor da consulta
      // anterior (decisão do cliente); exame tem valor próprio em
      // exam_types.price_cents; `null` aciona o texto de "incluso" na
      // notificação.
      priceCents: isExam ? examTypeInfo?.price_cents : appointmentType === "return_visit" ? null : location?.price_first_visit_cents,
    });
  }

  return redirect(`/admin/agenda?date=${date}`);
};
