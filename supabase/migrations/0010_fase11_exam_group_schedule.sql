-- Fase 11 (Exame em grupo/turma) — etapa 2: modelo de dados.
--
-- Alguns exames (ex.: Prick Test para aeroalérgenos) não seguem o padrão de
-- horário individual — o exame é sempre no mesmo horário fixo pra todos os
-- pacientes daquele dia, com um limite de vagas (mais de um paciente ao
-- mesmo tempo). `scheduling_mode='group'` marca esses exames; a tabela nova
-- guarda o(s) dia(s) da semana + horário fixo + capacidade de cada um,
-- no mesmo padrão de `availability_windows` (dia da semana + horário, não
-- datas avulsas). O cálculo de vagas disponíveis por essas linhas fica pra
-- etapa 3 — aqui só o cadastro.
alter table exam_types add column scheduling_mode text not null default 'individual'
  check (scheduling_mode in ('individual', 'group'));

create table exam_type_group_schedule (
  id uuid primary key default gen_random_uuid(),
  exam_type_id uuid not null references exam_types (id),
  weekday smallint not null check (weekday between 0 and 6),
  start_time time not null,
  capacity integer not null check (capacity > 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create index exam_type_group_schedule_exam_type_id_idx
  on exam_type_group_schedule (exam_type_id);

alter table exam_type_group_schedule enable row level security;

create policy "authenticated full access" on exam_type_group_schedule
  for all to authenticated
  using (auth.uid() is not null)
  with check (auth.uid() is not null);
