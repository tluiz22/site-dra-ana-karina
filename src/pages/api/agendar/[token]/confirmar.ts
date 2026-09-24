import type { APIRoute } from "astro";
import { createServiceClient } from "../../../../lib/supabase/service";
import { createEvent, rescheduleEvent } from "../../../../lib/google/calendar";
import { getAvailableSlotsForDate, type AppointmentType } from "../../../../lib/scheduling/getAvailableSlotsForDate";
import { getExamAvailableSlotsForDate } from "../../../../lib/scheduling/getExamAvailableSlotsForDate";
import { getNextAvailableGroupDates, type AvailableGroupSession } from "../../../../lib/scheduling/getNextAvailableGroupDates";
import { joinOrCreateGroupSessionEvent, leaveGroupSessionEvent } from "../../../../lib/scheduling/groupSessionCalendar";
import { resolveClinicLocationIds, type LocationCategory } from "../../../../lib/scheduling/resolveClinicLocationIds";
import {
  buildAppointmentTypeLabel,
  sendAppointmentConfirmation,
  sendAppointmentReschedule,
} from "../../../../lib/whatsapp/notifications";

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
    .select("*, exam_types ( name, duration_minutes, price_cents, preparation_instructions, scheduling_mode )")
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
    scheduling_mode: string;
  } | null;
  const isGroupExam = appointmentType === "exam" && examType?.scheduling_mode === "group";

  const { data: settings } = await supabase.from("appointment_settings").select("*").eq("id", 1).single();
  if (!settings) {
    return back("1");
  }

  let startDate: Date;
  let endDate: Date;
  let resolvedClinicLocationId: string;
  let durationMinutes: number;
  let matchedSession: AvailableGroupSession | undefined;

  if (isGroupExam) {
    // Sem freebusy do Calendar: revalida a sessão (data+horário fixo) contra
    // a capacidade recalculada agora — mesmo espírito da revalidação de
    // horário individual logo abaixo, só que contando vagas em vez de
    // conflito de agenda. A confirmação final ainda passa pela trava
    // atômica (`book_group_exam_session`/`reschedule_group_exam_session`)
    // mais abaixo — essa aqui é só uma primeira checagem, mais barata.
    const sessions = await getNextAvailableGroupDates({ supabase, examTypeId: link.exam_type_id ?? "" });
    matchedSession = sessions.find(
      (session) => new Date(`${session.date}T${session.startTime}:00-03:00`).toISOString() === startIso
    );
    if (!matchedSession) {
      return back("slot_taken");
    }
    resolvedClinicLocationId = link.clinic_location_id ?? "";
    durationMinutes = examType?.duration_minutes ?? settings.default_appointment_duration_minutes;
    startDate = new Date(`${matchedSession.date}T${matchedSession.startTime}:00-03:00`);
    endDate = new Date(`${matchedSession.date}T${matchedSession.endTime}:00-03:00`);
  } else if (appointmentType === "exam") {
    // Exame individual: disponibilidade própria do exame, não a de um local
    // (ver Fase 11).
    const slots = await getExamAvailableSlotsForDate({
      supabase,
      examTypeId: link.exam_type_id ?? "",
      examLocationId: link.clinic_location_id ?? "",
      date,
      examDurationMinutes: examType?.duration_minutes ?? 0,
    });

    const matchedSlot = slots.find((slot) => slot.start.toISOString() === startIso);
    if (!matchedSlot) {
      return back("slot_taken");
    }
    resolvedClinicLocationId = matchedSlot.clinicLocationId;
    durationMinutes = examType?.duration_minutes ?? settings.default_appointment_duration_minutes;
    startDate = matchedSlot.start;
    endDate = new Date(startDate.getTime() + durationMinutes * 60_000);
  } else {
    // Consulta/retorno: categoria mesclando todos os consultórios físicos
    // ativos dela (ver "Backlog futuro" no plano) — o horário escolhido
    // decide qual deles atende.
    const clinicLocationIds = await resolveClinicLocationIds(supabase, (link.location_category as LocationCategory) ?? "clinic");

    const slots = await getAvailableSlotsForDate({
      supabase,
      clinicLocationIds,
      date,
      appointmentType,
    });

    const matchedSlot = slots.find((slot) => slot.start.toISOString() === startIso);
    if (!matchedSlot) {
      return back("slot_taken");
    }
    resolvedClinicLocationId = matchedSlot.clinicLocationId;
    durationMinutes =
      appointmentType === "return_visit"
        ? settings.default_return_visit_duration_minutes
        : settings.default_appointment_duration_minutes;
    startDate = matchedSlot.start;
    endDate = new Date(startDate.getTime() + durationMinutes * 60_000);
  }

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
  const typeLabel = buildAppointmentTypeLabel(appointmentType, examType?.name);

  // Trava atômica contra corrida (duplo toque em "Confirmar", conexão
  // lenta): a checagem de `link.used_at` lá em cima não impede duas
  // requisições concorrentes de passarem juntas e criarem duas consultas
  // pro mesmo link. Esse UPDATE condicional só afeta a linha se `used_at`
  // ainda estiver nulo — a segunda requisição a chegar aqui recebe 0 linhas
  // e para, sem duplicar o agendamento.
  const { data: claimedLink } = await supabase
    .from("booking_links")
    .update({ used_at: new Date().toISOString() })
    .eq("id", token)
    .is("used_at", null)
    .select("id")
    .maybeSingle();

  if (!claimedLink) {
    return redirect(`/agendar/${token}`);
  }

  let appointmentId: string;

  if (link.mode === "reschedule") {
    const { data: appointment } = await supabase
      .from("appointments")
      .select("id, google_event_id, status, scheduled_at")
      .eq("id", link.appointment_id)
      .single();

    if (!appointment || !appointment.google_event_id || !["scheduled", "confirmed"].includes(appointment.status)) {
      return back("1");
    }

    appointmentId = appointment.id;

    if (isGroupExam && matchedSession) {
      const { error: rpcError } = await supabase.rpc("reschedule_group_exam_session", {
        p_appointment_id: appointment.id,
        p_exam_type_id: link.exam_type_id,
        p_scheduled_at: startDate.toISOString(),
        p_clinic_location_id: resolvedClinicLocationId,
        p_duration_minutes: durationMinutes,
      });
      if (rpcError) {
        return back("slot_taken");
      }

      // Sai da sessão antiga (some do evento compartilhado, ou cancela o
      // evento se era o último) e entra/cria o evento da sessão nova.
      const oldWeekday = new Date(new Date(appointment.scheduled_at).getTime() - 3 * 60 * 60 * 1000).getUTCDay();
      const oldTime = new Date(new Date(appointment.scheduled_at).getTime() - 3 * 60 * 60 * 1000)
        .toISOString()
        .slice(11, 16);
      const { data: oldWindow } = await supabase
        .from("exam_type_availability_windows")
        .select("capacity")
        .eq("exam_type_id", link.exam_type_id)
        .eq("weekday", oldWeekday)
        .eq("start_time", `${oldTime}:00`)
        .eq("is_active", true)
        .maybeSingle();

      await leaveGroupSessionEvent({
        supabase,
        appointmentIdLeaving: appointment.id,
        examTypeId: link.exam_type_id!,
        examName: examType?.name ?? "Exame",
        capacity: oldWindow?.capacity ?? matchedSession.capacity,
        startIso: appointment.scheduled_at,
        googleEventId: appointment.google_event_id,
      });

      const newEventId = await joinOrCreateGroupSessionEvent({
        supabase,
        appointmentId: appointment.id,
        examTypeId: link.exam_type_id!,
        examName: examType?.name ?? "Exame",
        capacity: matchedSession.capacity,
        startIso: startDate.toISOString(),
        endIso: endDate.toISOString(),
      });

      await supabase.from("appointments").update({ google_event_id: newEventId }).eq("id", appointment.id);
    } else {
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
    }

    if (guardian?.phone) {
      await sendAppointmentReschedule({
        supabase,
        appointmentId,
        guardianId: guardian.id,
        guardianPhone: guardian.phone,
        patientName: patient.full_name,
        typeLabel,
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

    if (isGroupExam && matchedSession) {
      const { data: newAppointmentId, error: rpcError } = await supabase.rpc("book_group_exam_session", {
        p_exam_type_id: link.exam_type_id,
        p_scheduled_at: startDate.toISOString(),
        p_patient_id: link.patient_id,
        p_clinic_location_id: resolvedClinicLocationId,
        p_duration_minutes: durationMinutes,
        p_booking_channel: "whatsapp_bot",
      });

      if (rpcError || !newAppointmentId) {
        return back("slot_taken");
      }

      appointmentId = newAppointmentId as string;

      const eventId = await joinOrCreateGroupSessionEvent({
        supabase,
        appointmentId,
        examTypeId: link.exam_type_id!,
        examName: examType?.name ?? "Exame",
        capacity: matchedSession.capacity,
        startIso: startDate.toISOString(),
        endIso: endDate.toISOString(),
      });

      await supabase.from("appointments").update({ google_event_id: eventId }).eq("id", appointmentId);
    } else {
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

      appointmentId = newAppointment.id;

      const event = await createEvent({
        summary: `${typeLabel} — ${patient.full_name}${guardian ? ` (resp. ${guardian.full_name})` : ""}`,
        description: `Tel: ${guardian?.phone ?? "—"} | Tipo: ${typeLabel} | Local: ${locationLabel}`,
        start: startDate.toISOString(),
        end: endDate.toISOString(),
        appointmentId: newAppointment.id,
      });

      await supabase.from("appointments").update({ google_event_id: event.id }).eq("id", newAppointment.id);
    }

    if (guardian?.phone) {
      await sendAppointmentConfirmation({
        supabase,
        appointmentId,
        guardianId: guardian.id,
        guardianPhone: guardian.phone,
        patientName: patient.full_name,
        typeLabel,
        scheduledAt: startDate,
        locationLabel,
        locationAddress,
        priceCents,
      });
    }
  }

  // `used_at` já foi gravado atomicamente acima — só falta guardar a
  // consulta gerada, para a página mostrar a confirmação mesmo se o link
  // for reaberto depois.
  await supabase.from("booking_links").update({ appointment_id: appointmentId }).eq("id", token);

  return redirect(`/agendar/${token}`);
};
