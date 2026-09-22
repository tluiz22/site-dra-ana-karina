-- Múltiplos consultórios físicos (2 endereços de type='clinic') — a partir
-- de agora, quem escolhe local (bot e admin) escolhe a CATEGORIA
-- ("Consultório" ou "Atendimento domiciliar"), não um endereço físico
-- específico: a data/horário escolhidos é que decidem qual consultório
-- físico atende (cada um com sua própria disponibilidade), como já previsto
-- no plano ("Backlog futuro — Múltiplos consultórios").
--
-- booking_links.clinic_location_id vira nulo até a confirmação na página
-- (quando o horário escolhido já diz a qual consultório físico pertence);
-- location_category guarda a categoria escolhida enquanto isso.
-- appointments.clinic_location_id continua sempre obrigatório — por ali só
-- passa depois de já resolvido para um local físico específico.

alter table booking_links alter column clinic_location_id drop not null;

alter table booking_links add column location_category text
  check (location_category in ('clinic', 'home_visit'));
