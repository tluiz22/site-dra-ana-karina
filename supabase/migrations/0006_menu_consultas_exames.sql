-- Reorganização do menu principal do bot: em vez de 7 opções soltas, agrupa
-- em "Consultas" (Agendar consulta/retorno, Cancelar, Remarcar) e "Exames"
-- (Marcar exame, Cancelar, Remarcar) — pedido do cliente depois de testar
-- (menu principal estava grande demais). Novos estados de submenu, mesmo
-- padrão de INFO_MENU.

alter table conversation_state drop constraint conversation_state_state_check;
alter table conversation_state add constraint conversation_state_state_check
  check (state in (
    'WELCOME',
    'MENU',
    'CONSULTAS_MENU',
    'EXAMES_MENU',
    'BOOK_MODALITY',
    'BOOK_LOCATION',
    'BOOK_PATIENT_SELECT',
    'BOOK_PATIENT_NEW',
    'BOOK_SLOT_SELECT',
    'BOOK_CONFIRM',
    'EXAM_TYPE_SELECT',
    'CANCEL_SELECT',
    'CANCEL_CONFIRM',
    'RESCHEDULE_SELECT',
    'RESCHEDULE_CONFIRM',
    'INFO_MENU',
    'HUMAN_HANDOFF'
  ));
