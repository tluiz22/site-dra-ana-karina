// Cliente de baixo nível para a Meta Cloud API (WhatsApp). Uso exclusivo
// do backend do bot — nunca importar em código que roda no browser, pois
// depende do token de acesso (secreto).

const GRAPH_API_VERSION = "v21.0";

function messagesUrl(): string {
  const phoneNumberId = import.meta.env.WHATSAPP_PHONE_NUMBER_ID;
  return `https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneNumberId}/messages`;
}

async function postToGraphApi(body: Record<string, unknown>): Promise<{ id: string }> {
  const response = await fetch(messagesUrl(), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${import.meta.env.WHATSAPP_CLOUD_API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(`WhatsApp API error: ${data?.error?.message ?? response.statusText}`);
  }

  return { id: data.messages[0].id };
}

// Mensagem de template (obrigatória fora da janela de 24h de conversa —
// é o que a Fase 3a usa para confirmação de agendamento e lembrete).
export async function sendTemplateMessage({
  to,
  templateName,
  languageCode,
  bodyParameters = [],
}: {
  to: string;
  templateName: string;
  languageCode: string;
  bodyParameters?: string[];
}): Promise<{ id: string }> {
  return postToGraphApi({
    messaging_product: "whatsapp",
    to: to.replace(/^\+/, ""),
    type: "template",
    template: {
      name: templateName,
      language: { code: languageCode },
      ...(bodyParameters.length > 0
        ? {
            components: [
              {
                type: "body",
                parameters: bodyParameters.map((text) => ({ type: "text", text })),
              },
            ],
          }
        : {}),
    },
  });
}

// Mensagem de texto livre — só é aceita pela Meta dentro da janela de 24h
// após a última mensagem do paciente (usada nas respostas da Fase 3b,
// não na Fase 3a).
export async function sendTextMessage({ to, body }: { to: string; body: string }): Promise<{ id: string }> {
  return postToGraphApi({
    messaging_product: "whatsapp",
    to: to.replace(/^\+/, ""),
    type: "text",
    text: { body },
  });
}
