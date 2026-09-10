-- Fase 3a: rastreamento de mensagens do WhatsApp.
--
-- `wa_message_id` guarda o id da Meta (wamid...) de cada mensagem, para
-- correlacionar os webhooks de status de entrega (sent/delivered/read/
-- failed) com a linha que originou o envio. O índice único dá idempotência
-- aos webhooks (a Meta reenvia eventos); NULLs são distintos no Postgres,
-- então linhas sem envio (skipped/failed) não conflitam entre si.
--
-- `guardian_id` passa a aceitar NULL: mensagens recebidas antes de o
-- telefone ser associado a um responsável (e echoes da secretária pelo
-- app para números ainda não cadastrados) também são registradas.

alter table whatsapp_messages add column wa_message_id text;
alter table whatsapp_messages alter column guardian_id drop not null;

create unique index whatsapp_messages_wa_message_id_key
  on whatsapp_messages (wa_message_id);
