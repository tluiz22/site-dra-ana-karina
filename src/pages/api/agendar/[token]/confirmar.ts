import type { APIRoute } from "astro";
import { createServiceClient } from "../../../../lib/supabase/service";
import { createEvent, rescheduleEvent } from "../../../../lib/google/calendar";
import { getAvailableSlotsForDate, type AppointmentType } from "../../../../lib/scheduling/getAvailableSlotsForDate";
import { resolveClinicLocationIds, type LocationCategory } from "../../../../lib/scheduling/resolveClinicLocationIds";
import { sendAppointmentConfirmation, sendAppointmentReschedule } from "../../../../lib/whatsapp/notifications";

export const POST: APIRoute = async ({ params, request, redirect }) => {
  const token = params.token;
  const formData = await request.formData();
  const date = formData.get("date")?.toString();
  // O rádio de horário carrega "<iso>|<clinicLocationId>" — o consultório
  // físico específico (entre os que a categoria escolhida engloba) já vem
  // decidido pelo horário escolhido, não é reconferido aqui: revalidamos
  // contra a lista de horários recalculada no servidor e usamos o
  // clinicLocationId QUE ELA devolve, nunca o que o cliente mandou.
  const startParam = formData.get("start")?.toString();
  const startIso = startParam?.split("|")[0];

  const back = (error: string) => redirect(`/agendar/${token}?date=${date ?? ""}&error=${error}`);

  if (!token || !date || !startIso) {
    return back("1");
  }

  const supabase = createServiceClient();

  const { data: link } = await supabase
    .from("booking_links")
    .select("*, exam_types ( name, duration_minutes, price_cents, preparation_instructions )")
    .eq("id", token)
    .maybeSingle();

  // Link inexistente, já usado ou expirado: manda de volta para a página,
  // que mostra o estado certo (usado = confirmação, expirado/inválido = aviso).
  if (!link || link.used_at || new Date(link.expires_at) < new Date()) {
    return redirect(`/agendar/${token}`);
  }

  const appointmentType = link.appointment_type as AppointmentType;
  const examType = link.exam_types as unknown as {
    name: string;
    duration_minutes: number;
    price_cents: number;
    preparation_instructions: string | null;
  } | null;

  // Exame: local único, já resolvido. Consulta/retorno: categoria mesclando
  // todos os consultórios físicos ativos dela (ver "Backlog futuro" no
  // plano) — o horário escolhido decide qual deles atende.
  const clinicLocationIds =
    appointmentType === "exam"
      ? link.clinic_location_id
        ? [link.clinic_location_id]
        : []
      : await resolveClinicLocationIds(supabase, (link.location_category as LocationCategory) ?? "clinic");

  const [{ data: settings }, slots] = await Promise.all([
    supabase.from("appointment_settings").select("*").eq("id", 1).single(),
    getAvailableSlotsForDate({
      supabase,
      clinicLocationIds,
      date,
      appointmentType,
      examDurationMinutes: examType?.duration_minutes,
    }),
  ]);

  if (!settings) {
    return back("1");
  }

  const matchedSlot = slots.find((slot) => slot.start.toISOString() === startIso);
  if (!matchedSlot) {
    return back("slot_taken");
  }
  const resolvedClinicLocationId = matchedSlot.clinicLocationId;

  const durationMinutes =
    appointmentType === "exam"
      ? (examType?.duration_minutes ?? settings.default_appointment_duration_minutes)
      : appointmentType === "return_visit"
        ? settings.default_return_visit_duration_minutes
        : settings.default_appointment_duration_minutes;

  const startDate = matchedSlot.start;
  const endDate = new Date(startDate.getTime() + durationMinutes * 60_000);

  const [{ data: patient }, { data: location }] = await Promise.all([
    supabase
      .from("patients")
      .select("full_name, guardians ( id, full_name, phone )")
      .eq("id", link.patient_id)
      .single(),
    supabase
      .from("clinic_locations")
      .select("type, address, price_first_visit_cents")
      .eq("id", resolvedClinicLocationId)
      .single(),
  ]);

  if (!patient) {
    return back("1");
  }

  const guardian = (patient.guardians ?? null) as unknown as {
    id: string;
    full_name: string;
    phone: string;
  } | null;
  const locationLabel = location?.type === "clinic" ? "Consultório" : location?.type === "exam" ? "Exames" : "Domiciliar";
  const locationAddress = location?.address ?? null;
  // Retorno não tem valor próprio — está incluso no valor da consulta
  // anterior (decisão do cliente); `null` aciona esse texto na notificação.
  // Exame tem valor próprio, em exam_types (não em clinic_locations).
  const priceCents =
    appointmentType === "exam" ? examType?.price_cents : appointmentType === "return_visit" ? null : location?.price_first_visit_cents;
  const typeLabel =
    appointmentType === "exam" ? (examType?.name ?? "Exame") : appointmentType === "return_visit" ? "Retorno" : "Consulta";

  let appointmentId: string;

  if (link.mode === "reschedule") {
    const { data: appointment } = await supabase
      .from("appointments")
      .select("id, google_event_id, status")
      .eq("id", link.appointment_id)
      .single();

    if (!appointment || !appointment.google_event_id || !["scheduled", "confirmed"].includes(appointment.status)) {
      return back("1");
    }

    await supabase
      .from("appointments")
      .update({
        clinic_location_id: resolvedClinicLocationId,
        scheduled_at: startDate.toISOString(),
        duration_minutes: durationMinutes,
        appointment_type: appointmentType,
      })
      .eq("id", appointment.id);

    await rescheduleEvent(appointment.google_event_id, {
      start: startDate.toISOString(),
      end: endDate.toISOString(),
    });

    appointmentId = appointment.id;

    // Notificação de remarcação de exame fica pendente do template
    // `exame_remarcado` (ainda não submetido à Meta — ver plano, Fase 6).
    if (guardian?.phone && appointmentType !== "exam") {
      await sendAppointmentReschedule({
        supabase,
        appointmentId,
        guardianId: guardian.id,
        guardianPhone: guardian.phone,
        patientName: patient.full_name,
        scheduledAt: startDate,
        locationLabel,
        locationAddress,
      });
    }
  } else {
    // Mesma trava do admin, agora por categoria (consulta/exame são
    // jornadas separadas, set/2026): bloqueia um segundo agendamento futuro
    // do MESMO tipo — duas consultas/retornos, ou o mesmo tipo de exame
    // duas vezes — mas permite consulta e exame simultâneos.
    let duplicateQuery = supabase
      .from("appointments")
      .select("id")
      .eq("patient_id", link.patient_id)
      .in("status", ["scheduled", "confirmed"])
      .gt("scheduled_at", new Date().toISOString());

    duplicateQuery =
      appointmentType === "exam"
        ? duplicateQuery.eq("appointment_type", "exam").eq("exam_type_id", link.exam_type_id ?? "")
        : duplicateQuery.in("appointment_type", ["first_visit", "return_visit"]);

    const { data: existingFutureAppointment } = await duplicateQuery.limit(1).maybeSingle();

    if (existingFutureAppointment) {
      return back("1");
    }

    const { data: newAppointment, error: insertError } = await supabase
      .from("appointments")
      .insert({
        patient_id: link.patient_id,
        clinic_location_id: resolvedClinicLocationId,
        scheduled_at: startDate.toISOString(),
        duration_minutes: durationMinutes,
        appointment_type: appointmentType,
        exam_type_id: appointmentType === "exam" ? link.exam_type_id : null,
        status: "scheduled",
        booking_channel: "whatsapp_bot",
      })
      .select("id")
      .single();

    if (insertError || !newAppointment) {
      return back("1");
    }

    const event = await createEvent({
      summary: `${typeLabel} — ${patient.full_name}${guardian ? ` (resp. ${guardian.full_name})` : ""}`,
      description: `Tel: ${guardian?.phone ?? "—"} | Tipo: ${typeLabel} | Local: ${locationLabel}`,
      start: startDate.toISOString(),
      end: endDate.toISOString(),
      appointmentId: newAppointment.id,
    });

    await supabase.from("appointments").update({ google_event_id: event.id }).eq("id", newAppointment.id);

    appointmentId = newAppointment.id;

    // Notificação de confirmação de exame fica pendente do template
    // `exame_confirmado` (ainda não submetido à Meta — ver plano, Fase 6).
    if (guardian?.phone && appointmentType !== "exam") {
      await sendAppointmentConfirmation({
        supabase,
        appointmentId,
        guardianId: guardian.id,
        guardianPhone: guardian.phone,
        patientName: patient.full_name,
        scheduledAt: startDate,
        locationLabel,
        locationAddress,
        priceCents,
      });
    }
  }

  // Uso único: marca o link como usado e guarda a consulta gerada, para a
  // página mostrar a confirmação mesmo se o link for reaberto depois.
  await supabase
    .from("booking_links")
    .update({ used_at: new Date().toISOString(), appointment_id: appointmentId })
    .eq("id", token);

  return redirect(`/agendar/${token}`);
};
