-- Ajuste pós-lançamento da Fase 13, pedido pelo cliente na aba "Aguardando
-- remarcação" (Fase 12) de /admin/consultas:
--
-- `canceled_at`: quando o cancelamento de fato aconteceu — não confundir
-- com `scheduled_at` (a data do atendimento que foi cancelado). Sem essa
-- coluna, "mostrar sempre o cancelamento mais recente" não tinha como ser
-- decidido quando o mesmo paciente tem mais de um cancelamento pela equipe
-- pro mesmo tipo de atendimento.
alter table appointments
  add column canceled_at timestamptz;

-- `rebooking_dismissed_at`: a equipe marcou que não vai mais acompanhar
-- esse cancelamento (ex.: o responsável avisou que desistiu da consulta) —
-- tira o paciente da aba "Aguardando remarcação" sem apagar o histórico.
alter table appointments
  add column rebooking_dismissed_at timestamptz;
