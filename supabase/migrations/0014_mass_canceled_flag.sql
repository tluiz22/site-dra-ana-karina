-- Ajuste pedido pelo cliente na aba "Aguardando remarcação" de
-- /admin/consultas: só deve listar cancelamentos feitos pela rotina de
-- cancelamento em massa (`cancelAppointmentsInBulk`, usada tanto pelo
-- "Cancelar selecionados" do Resumo do dia quanto pelo "Cancelar
-- atendimentos e bloquear" da Fase 13) — não um cancelamento individual
-- (botão "Cancelar" avulso na Agenda ou no Resumo do dia), que já é uma
-- ação pontual da própria secretária, sem precisar de acompanhamento à
-- parte. `canceled_via` continua só pra origem (admin/whatsapp_bot); esta
-- coluna marca especificamente "veio de uma ação em lote".
alter table appointments
  add column mass_canceled boolean not null default false;
