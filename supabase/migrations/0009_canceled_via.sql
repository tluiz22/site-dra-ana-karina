-- Fase 12 (Cancelamento em massa de um dia) — etapa 1: registra quem
-- iniciou o cancelamento de um atendimento, mesmo padrão já usado em
-- `booking_channel` ('admin' | 'whatsapp_bot'). Necessário pra "Aguardando
-- remarcação" (Fase 12) saber quais cancelamentos foram feitos pela equipe
-- (não pelo próprio responsável) e precisam de acompanhamento.
alter table appointments
  add column canceled_via text check (canceled_via in ('admin', 'whatsapp_bot'));
