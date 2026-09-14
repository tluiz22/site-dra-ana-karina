// Tipo mínimo do payload de mensagem da Meta Cloud API — compartilhado
// pelo webhook (`src/pages/api/whatsapp/webhook.ts`) e pelo roteador da
// máquina de estados do bot (`./bot/router.ts`, Fase 3b).
export interface WaMessage {
  id?: string;
  from?: string;
  to?: string;
  type?: string;
  text?: { body?: string };
  button?: { text?: string };
  interactive?: {
    list_reply?: { id?: string; title?: string };
    button_reply?: { id?: string; title?: string };
  };
}
