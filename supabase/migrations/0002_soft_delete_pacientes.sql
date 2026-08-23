-- Fase 2: exclusão lógica de responsáveis/pacientes (necessária porque um único
-- responsável — ex. prefeitura conveniada — pode ter dezenas/centenas de crianças
-- vinculadas; "excluir" nunca deve apagar histórico de consultas).

alter table guardians add column is_active boolean not null default true;
alter table patients add column is_active boolean not null default true;

create index guardians_is_active_idx on guardians (is_active);
create index patients_is_active_idx on patients (is_active);
