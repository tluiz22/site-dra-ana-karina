-- Fase 11 (Exame em grupo/turma) — etapa 2, revisão pedida pelo cliente:
-- disponibilidade (dia da semana + horário início/fim) cadastrável por
-- QUALQUER exame (individual ou em grupo), na mesma tela/lista de
-- Configurações > Disponibilidade, ao lado dos locais — não numa seção à
-- parte em Configurações > Exames. "Vagas" continua existindo, mas só é
-- obrigatório pra exame em modo grupo (fica em branco pra individual).
--
-- Por decisão explícita do cliente, isso fica numa tabela própria (não
-- mexe em `availability_windows`, usada todo dia pelo agendamento de
-- consulta/retorno) — só renomeia/ajusta a tabela criada na migração
-- anterior (0010), que ainda não tinha dado registrada em produção.
alter table exam_type_group_schedule rename to exam_type_availability_windows;

alter index exam_type_group_schedule_exam_type_id_idx
  rename to exam_type_availability_windows_exam_type_id_idx;

alter table exam_type_availability_windows add column end_time time;
update exam_type_availability_windows set end_time = start_time + interval '1 hour' where end_time is null;
alter table exam_type_availability_windows alter column end_time set not null;
alter table exam_type_availability_windows
  add constraint exam_type_availability_windows_time_order check (start_time < end_time);

alter table exam_type_availability_windows alter column capacity drop not null;
alter table exam_type_availability_windows drop constraint if exists exam_type_group_schedule_capacity_check;
alter table exam_type_availability_windows
  add constraint exam_type_availability_windows_capacity_check check (capacity is null or capacity > 0);
