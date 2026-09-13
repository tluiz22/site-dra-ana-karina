-- Fase 3b: links de agendamento/remarcação de uso único.
--
-- Sustenta a página pública `/agendar/[token]` (ver plano, seção "Agendamento
-- e remarcação via página web"): o bot do WhatsApp gera uma linha aqui e
-- envia `id` como token na URL em vez de conduzir a escolha de data/horário
-- dentro da própria conversa. `id` já é um uuid aleatório (mesmo padrão de
-- todas as outras tabelas), então serve como o próprio token sem precisar
-- de um segredo à parte.
--
-- Não recebe policy para `anon`: a página lê/grava usando a mesma
-- service-role key já usada pelo webhook do WhatsApp (`createServiceClient`),
-- nunca acesso público via RLS.

create table booking_links (
  id uuid primary key default gen_random_uuid(),
  guardian_id uuid not null references guardians (id),
  patient_id uuid not null references patients (id),
  clinic_location_id uuid not null references clinic_locations (id),
  appointment_type text not null check (appointment_type in ('first_visit', 'return_visit')),
  mode text not null check (mode in ('create', 'reschedule')),
  appointment_id uuid references appointments (id),
  guardian_phone text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now(),
  constraint booking_links_reschedule_requires_appointment
    check (mode = 'create' or appointment_id is not null)
);

alter table booking_links enable row level security;

create policy "authenticated full access" on booking_links
  for all to authenticated
  using (auth.uid() is not null)
  with check (auth.uid() is not null);
