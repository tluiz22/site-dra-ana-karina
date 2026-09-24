-- Fase 11 (Exame em grupo/turma) — etapa 4: trava de concorrência na vaga.
--
-- O cálculo de vagas em `getNextAvailableGroupDates` (app) conta os
-- agendamentos existentes no momento da consulta, mas duas confirmações
-- endo simultâneas passam pela mesma contagem antes de qualquer uma
-- inserir — sem trava, as duas veem "1 vaga livre" e as duas confirmam,
-- estourando a capacidade. As duas funções abaixo fazem a contagem +
-- inserção/atualização dentro de uma única transação, travando a(s) linha(s)
-- de `exam_type_availability_windows` daquele exame+dia+horário
-- (`for update`) — a segunda transação concorrente espera a primeira
-- terminar (e só então reconta, já enxergando o agendamento que acabou de
-- ser criado), em vez de rodar em paralelo sobre os mesmos dados.
create or replace function book_group_exam_session(
  p_exam_type_id uuid,
  p_scheduled_at timestamptz,
  p_patient_id uuid,
  p_clinic_location_id uuid,
  p_duration_minutes integer,
  p_booking_channel text
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_capacity integer;
  v_booked integer;
  v_appointment_id uuid;
  v_weekday integer;
  v_time time;
begin
  v_weekday := extract(dow from (p_scheduled_at at time zone 'America/Fortaleza'));
  v_time := (p_scheduled_at at time zone 'America/Fortaleza')::time;

  perform 1 from exam_type_availability_windows
    where exam_type_id = p_exam_type_id
      and weekday = v_weekday
      and start_time = v_time
      and is_active = true
    for update;

  select capacity into v_capacity
    from exam_type_availability_windows
    where exam_type_id = p_exam_type_id
      and weekday = v_weekday
      and start_time = v_time
      and is_active = true
    limit 1;

  if v_capacity is null then
    raise exception 'no_window';
  end if;

  select count(*) into v_booked
    from appointments
    where exam_type_id = p_exam_type_id
      and appointment_type = 'exam'
      and status in ('scheduled', 'confirmed')
      and scheduled_at = p_scheduled_at;

  if v_booked >= v_capacity then
    raise exception 'slot_full';
  end if;

  insert into appointments (
    patient_id, clinic_location_id, exam_type_id, appointment_type,
    scheduled_at, duration_minutes, status, booking_channel
  )
  values (
    p_patient_id, p_clinic_location_id, p_exam_type_id, 'exam',
    p_scheduled_at, p_duration_minutes, 'scheduled', p_booking_channel
  )
  returning id into v_appointment_id;

  return v_appointment_id;
end;
$$;

-- Mesma trava, pra mover um agendamento já existente pra outra sessão
-- (remarcação) — a contagem exclui o próprio agendamento (senão ele
-- competiria com vaga dele mesmo antes de sair da sessão antiga).
create or replace function reschedule_group_exam_session(
  p_appointment_id uuid,
  p_exam_type_id uuid,
  p_scheduled_at timestamptz,
  p_clinic_location_id uuid,
  p_duration_minutes integer
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_capacity integer;
  v_booked integer;
  v_weekday integer;
  v_time time;
begin
  v_weekday := extract(dow from (p_scheduled_at at time zone 'America/Fortaleza'));
  v_time := (p_scheduled_at at time zone 'America/Fortaleza')::time;

  perform 1 from exam_type_availability_windows
    where exam_type_id = p_exam_type_id
      and weekday = v_weekday
      and start_time = v_time
      and is_active = true
    for update;

  select capacity into v_capacity
    from exam_type_availability_windows
    where exam_type_id = p_exam_type_id
      and weekday = v_weekday
      and start_time = v_time
      and is_active = true
    limit 1;

  if v_capacity is null then
    raise exception 'no_window';
  end if;

  select count(*) into v_booked
    from appointments
    where exam_type_id = p_exam_type_id
      and appointment_type = 'exam'
      and status in ('scheduled', 'confirmed')
      and scheduled_at = p_scheduled_at
      and id != p_appointment_id;

  if v_booked >= v_capacity then
    raise exception 'slot_full';
  end if;

  update appointments
    set clinic_location_id = p_clinic_location_id,
        scheduled_at = p_scheduled_at,
        duration_minutes = p_duration_minutes,
        appointment_type = 'exam'
    where id = p_appointment_id;
end;
$$;

grant execute on function book_group_exam_session(uuid, timestamptz, uuid, uuid, integer, text) to authenticated, service_role;
grant execute on function reschedule_group_exam_session(uuid, uuid, timestamptz, uuid, integer) to authenticated, service_role;
