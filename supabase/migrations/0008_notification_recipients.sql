-- Fase 7: lista de destinatários do resumo diário por WhatsApp — em vez de
-- 2 campos fixos (médica/secretária) em appointment_settings, uma lista
-- flexível: suporta múltiplas secretárias, alguém dos exames, e permite
-- cadastrar/remover um número de teste em produção sem precisar de nova
-- migração/código. Cada linha escolhe se recebe o resumo de consultas
-- e/ou o de exames (a médica recebe os dois, a secretária só o de exames,
-- por exemplo). Exclusão é lógica (`is_active`), mesmo padrão já usado em
-- guardians/patients.

create table notification_recipients (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  phone text not null unique,
  receives_consultas boolean not null default false,
  receives_exames boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create index notification_recipients_is_active_idx on notification_recipients (is_active);

alter table notification_recipients enable row level security;

create policy "authenticated full access" on notification_recipients
  for all to authenticated
  using (auth.uid() is not null)
  with check (auth.uid() is not null);
