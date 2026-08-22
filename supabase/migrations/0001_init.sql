-- Fase 1 · item 3: modelo de dados inicial
-- Supabase é um espelho leve de apoio; o Google Calendar é a fonte da
-- verdade da agenda em si (ver plano, seção "Fase 2/3").

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- clinic_locations
-- ---------------------------------------------------------------------
create table clinic_locations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  type text not null check (type in ('clinic', 'home_visit')),
  address text,
  is_active boolean not null default true,
  price_first_visit_cents integer not null,
  price_return_visit_cents integer not null,
  created_at timestamptz not null default now()
);

insert into clinic_locations (name, type, address, price_first_visit_cents, price_return_visit_cents)
values
  ('Instituto Andre Camurça', 'clinic', null, 0, 0),
  ('Atendimento domiciliar', 'home_visit', null, 0, 0);

-- ---------------------------------------------------------------------
-- availability_windows
-- ---------------------------------------------------------------------
create table availability_windows (
  id uuid primary key default gen_random_uuid(),
  clinic_location_id uuid not null references clinic_locations (id),
  weekday smallint not null check (weekday between 0 and 6),
  start_time time not null,
  end_time time not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint availability_windows_time_order check (start_time < end_time)
);

create index availability_windows_clinic_location_id_idx
  on availability_windows (clinic_location_id);

-- ---------------------------------------------------------------------
-- appointment_settings (singleton)
-- ---------------------------------------------------------------------
create table appointment_settings (
  id integer primary key default 1 check (id = 1),
  default_appointment_duration_minutes integer not null default 30,
  default_return_visit_duration_minutes integer not null default 20,
  buffer_minutes_between_appointments integer not null default 0,
  updated_at timestamptz not null default now()
);

insert into appointment_settings (id) values (1);

-- ---------------------------------------------------------------------
-- guardians
-- ---------------------------------------------------------------------
create table guardians (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  phone text not null unique,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- patients
-- ---------------------------------------------------------------------
create table patients (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  birthdate date not null,
  guardian_id uuid not null references guardians (id),
  notes text,
  created_at timestamptz not null default now()
);

create index patients_guardian_id_idx on patients (guardian_id);

-- ---------------------------------------------------------------------
-- appointments (log/espelho do Google Calendar, não dono do agendamento)
-- ---------------------------------------------------------------------
create table appointments (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references patients (id),
  clinic_location_id uuid not null references clinic_locations (id),
  google_event_id text,
  scheduled_at timestamptz not null,
  duration_minutes integer not null,
  appointment_type text not null check (appointment_type in ('first_visit', 'return_visit')),
  status text not null default 'scheduled'
    check (status in ('scheduled', 'confirmed', 'completed', 'canceled', 'no_show')),
  booking_channel text not null check (booking_channel in ('admin', 'whatsapp_bot')),
  reminder_sent_at timestamptz,
  confirmed_at timestamptz,
  created_at timestamptz not null default now()
);

create index appointments_patient_id_idx on appointments (patient_id);
create index appointments_scheduled_at_idx on appointments (scheduled_at);
create index appointments_google_event_id_idx on appointments (google_event_id);

-- ---------------------------------------------------------------------
-- whatsapp_messages
-- ---------------------------------------------------------------------
create table whatsapp_messages (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid references appointments (id),
  guardian_id uuid not null references guardians (id),
  direction text not null check (direction in ('inbound', 'outbound')),
  message_type text not null,
  template_name text,
  body text,
  status text,
  created_at timestamptz not null default now()
);

create index whatsapp_messages_guardian_id_idx on whatsapp_messages (guardian_id);
create index whatsapp_messages_appointment_id_idx on whatsapp_messages (appointment_id);

-- ---------------------------------------------------------------------
-- conversation_state
-- ---------------------------------------------------------------------
create table conversation_state (
  id uuid primary key default gen_random_uuid(),
  guardian_phone text not null unique,
  guardian_id uuid references guardians (id),
  state text not null default 'WELCOME' check (state in (
    'WELCOME',
    'MENU',
    'BOOK_MODALITY',
    'BOOK_LOCATION',
    'BOOK_PATIENT_SELECT',
    'BOOK_PATIENT_NEW',
    'BOOK_SLOT_SELECT',
    'BOOK_CONFIRM',
    'CANCEL_SELECT',
    'CANCEL_CONFIRM',
    'RESCHEDULE_SELECT',
    'RESCHEDULE_CONFIRM',
    'INFO_MENU',
    'HUMAN_HANDOFF'
  )),
  context jsonb not null default '{}'::jsonb,
  atendimento_humano boolean not null default false,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- RLS: os dois usuários (médica e secretária) têm acesso total e
-- idêntico, sem papel/dono de linha. Nenhuma policy é criada para
-- `anon`, então requisição não autenticada é barrada pelo Postgres.
-- ---------------------------------------------------------------------
alter table clinic_locations enable row level security;
alter table availability_windows enable row level security;
alter table appointment_settings enable row level security;
alter table guardians enable row level security;
alter table patients enable row level security;
alter table appointments enable row level security;
alter table whatsapp_messages enable row level security;
alter table conversation_state enable row level security;

create policy "authenticated full access" on clinic_locations
  for all to authenticated
  using (auth.uid() is not null)
  with check (auth.uid() is not null);

create policy "authenticated full access" on availability_windows
  for all to authenticated
  using (auth.uid() is not null)
  with check (auth.uid() is not null);

create policy "authenticated full access" on appointment_settings
  for all to authenticated
  using (auth.uid() is not null)
  with check (auth.uid() is not null);

create policy "authenticated full access" on guardians
  for all to authenticated
  using (auth.uid() is not null)
  with check (auth.uid() is not null);

create policy "authenticated full access" on patients
  for all to authenticated
  using (auth.uid() is not null)
  with check (auth.uid() is not null);

create policy "authenticated full access" on appointments
  for all to authenticated
  using (auth.uid() is not null)
  with check (auth.uid() is not null);

create policy "authenticated full access" on whatsapp_messages
  for all to authenticated
  using (auth.uid() is not null)
  with check (auth.uid() is not null);

create policy "authenticated full access" on conversation_state
  for all to authenticated
  using (auth.uid() is not null)
  with check (auth.uid() is not null);
