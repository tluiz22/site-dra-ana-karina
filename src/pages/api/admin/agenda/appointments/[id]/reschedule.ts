import type { APIRoute } from "astro";
import { createClient } from "../../../../../../lib/supabase/server";
import { rescheduleEvent } from "../../../../../../lib/google/calendar";
import { getAvailableSlotsForDate, type AppointmentType } from "../../../../../../lib/scheduling/getAvailableSlotsForDate";
import { resolveClinicLocationIds, type LocationCategory } from "../../../../../../lib/scheduling/resolveClinicLocationIds";
import { sendAppointmentReschedule } from "../../../../../../lib/whatsapp/notifications";

export const POST: APIRoute = async ({ params, request, cookies, redirect }) => {
  const { id } = params;
  const formData = await request.formData();
  const locationCategoryRaw = formData.get("location_category")?.toString();
  const date = formData.get("date")?.toString();
  const appointmentTypeRaw = formData.get("appointment_type")?.toString();
  // O rádio de horário carrega "<iso>|<clinicLocationId>" — o consultório
  // físico específico (entre os que a categoria escolhida engloba) já vem
  // decidido pelo horário escolhido; revalidamos contra a lista recalculada
  // no servidor e usamos o clinicLocationId QUE ELA devolve.
  const startParam = formData.get("start")?.toString();
  const startIso = startParam?.split("|")[0];

  const appointmentType: AppointmentType | null =
    appointmentTypeRaw === "first_visit" || appointmentTypeRaw === "return_visit"
      ? appointmentTypeRaw
      : null;
  const locationCategory: LocationCategory = locationCategoryRaw === "home_visit" ? "home_visit" : "clinic";

  const back = (error: string) =>
    redirect(
      `/admin/agenda/remarcar?appointment_id=${id}&location_category=${locationCategory}&date=${date ?? ""}&appointment_type=${appointmentType ?? "first_visit"}&error=${error}`
    );

  if (!id || !date || !startIso || !appointmentType) {
    return back("1");
  }

  const supabase = createClient(request, cookies);

  const { data: appointment } = await supabase
    .from("appointments")
    .select("id, google_event_id, status, patients ( full_name, guardians ( id, full_name, phone ) )")
    .eq("id", id)
    .single();

  if (!appointment || !appointment.google_event_id || !["scheduled", "confirmed"].includes(appointment.status)) {
    return back("1");
  }

  const clinicLocationIds = await resolveClinicLocationIds(supabase, locationCategory);

  const [{ data: settings }, slots] = await Promise.all([
    supabase.from("appointment_settings").select("*").eq("id", 1).single(),
    getAvailableSlotsForDate({ supabase, clinicLocationIds, date, appointmentType }),
  ]);

  if (!settings) {
    return back("1");
  }

  const matchedSlot = slots.find((slot) => slot.start.toISOString() === startIso);
  if (!matchedSlot) {
    return back("slot_taken");
  }
  const clinicLocationId = matchedSlot.clinicLocationId;

  const durationMinutes =
    appointmentType === "return_visit"
      ? settings.default_return_visit_duration_minutes
      : settings.default_appointment_duration_minutes;

  const startDate = matchedSlot.start;
  const endDate = new Date(startDate.getTime() + durationMinutes * 60_000);

  await supabase
    .from("appointments")
    .update({
      clinic_location_id: clinicLocationId,
      scheduled_at: startDate.toISOString(),
      duration_minutes: durationMinutes,
      appointment_type: appointmentType,
    })
    .eq("id", id);

  await rescheduleEvent(appointment.google_event_id, {
    start: startDate.toISOString(),
    end: endDate.toISOString(),
  });

  // Notificação de remarcação por WhatsApp (Fase 3a) — melhor esforço.
  const patient = (appointment.patients ?? null) as unknown as {
    full_name: string;
    guardians: { id: string; full_name: string; phone: string } | null;
  } | null;
  const guardian = patient?.guardians ?? null;

  if (patient && guardian?.phone) {
    const { data: location } = await supabase
      .from("clinic_locations")
      .select("type, address")
      .eq("id", clinicLocationId)
      .single();

    await sendAppointmentReschedule({
      supabase,
      appointmentId: id,
      guardianId: guardian.id,
      guardianPhone: guardian.phone,
      patientName: patient.full_name,
      scheduledAt: startDate,
      locationLabel: location?.type === "clinic" ? "Consultório" : "Domiciliar",
      locationAddress: location?.address ?? null,
    });
  }

  return redirect(`/admin/agenda?date=${date}`);
};
