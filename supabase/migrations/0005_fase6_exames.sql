-- Fase 6: marcar exames.
--
-- Decisão confirmada com o cliente: um único local novo para exames (não
-- um local por tipo de exame) — os tipos de exame são só uma lista de
-- nomes/instruções dentro desse local, mais simples de manter (ver plano,
-- seção "Fase 6 — Marcar exames").

-- ---------------------------------------------------------------------
-- clinic_locations: novo type 'exam' + o local único de exames
-- ---------------------------------------------------------------------
alter table clinic_locations drop constraint clinic_locations_type_check;
alter table clinic_locations add constraint clinic_locations_type_check
  check (type in ('clinic', 'home_visit', 'exam'));

insert into clinic_locations (name, type, address, price_first_visit_cents, price_return_visit_cents)
values ('Exames', 'exam', null, 0, 0);

-- ---------------------------------------------------------------------
-- exam_types — tipos de exame (nome, duração, preço, preparo). Sem
-- clinic_location_id própria: todo exame usa o único local type='exam'.
-- ---------------------------------------------------------------------
create table exam_types (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  duration_minutes integer not null,
  price_cents integer not null,
  preparation_instructions text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table exam_types enable row level security;

create policy "authenticated full access" on exam_types
  for all to authenticated
  using (auth.uid() is not null)
  with check (auth.uid() is not null);

-- ---------------------------------------------------------------------
-- appointments: appointment_type ganha 'exam' + exam_type_id (nulo,
-- só preenchido quando appointment_type='exam')
-- ---------------------------------------------------------------------
alter table appointments drop constraint appointments_appointment_type_check;
alter table appointments add constraint appointments_appointment_type_check
  check (appointment_type in ('first_visit', 'return_visit', 'exam'));

alter table appointments add column exam_type_id uuid references exam_types (id);

-- ---------------------------------------------------------------------
-- booking_links: mesma extensão de appointment_type + exam_type_id,
-- para carregar o exame escolhido até a confirmação em /agendar/[token]
-- ---------------------------------------------------------------------
alter table booking_links drop constraint booking_links_appointment_type_check;
alter table booking_links add constraint booking_links_appointment_type_check
  check (appointment_type in ('first_visit', 'return_visit', 'exam'));

alter table booking_links add column exam_type_id uuid references exam_types (id);

-- ---------------------------------------------------------------------
-- conversation_state: novo estado EXAM_TYPE_SELECT (case "Marcar exame"
-- do menu principal). Reaproveita BOOK_PATIENT_SELECT/BOOK_PATIENT_NEW
-- para a identificação da criança, como o case Agendar já faz.
-- ---------------------------------------------------------------------
alter table conversation_state drop constraint conversation_state_state_check;
alter table conversation_state add constraint conversation_state_state_check
  check (state in (
    'WELCOME',
    'MENU',
    'BOOK_MODALITY',
    'BOOK_LOCATION',
    'BOOK_PATIENT_SELECT',
    'BOOK_PATIENT_NEW',
    'BOOK_SLOT_SELECT',
    'BOOK_CONFIRM',
    'EXAM_TYPE_SELECT',
    'CANCEL_SELECT',
    'CANCEL_CONFIRM',
    'RESCHEDULE_SELECT',
    'RESCHEDULE_CONFIRM',
    'INFO_MENU',
    'HUMAN_HANDOFF'
  ));
