// Textos e menus do bot de WhatsApp (Fase 3b). Mantido separado do roteador
// (`./router.ts`) para deixar o conteúdo das mensagens fácil de revisar e
// ajustar sem mexer na lógica de estados.

import type { ListSection } from "../client";

const DOCTOR_NAME = "Dra. Ana Karina Fernandes";

export const MENU_LIST_ID = {
  agendar: "menu_agendar",
  cancelar: "menu_cancelar",
  remarcar: "menu_remarcar",
  informacoes: "menu_informacoes",
} as const;

export const INFO_LIST_ID = {
  valores: "info_valores",
  convenios: "info_convenios",
  endereco: "info_endereco",
  secretaria: "info_secretaria",
} as const;

// Decisão de negócio #1 do plano: o aviso de atendimento particular vem
// junto com o nome da clínica, na própria mensagem de boas-vindas — antes
// de qualquer pergunta de agendamento.
export function welcomeText(): string {
  return `Olá! 👋 Você está falando com o consultório da ${DOCTOR_NAME} (atendimento particular, sem convênio).`;
}

export function menuBodyText(): string {
  return "Como podemos ajudar hoje? Escolha uma opção abaixo (ou digite o número).";
}

export function menuSections(): ListSection[] {
  return [
    {
      rows: [
        { id: MENU_LIST_ID.agendar, title: "1. Agendar consulta" },
        { id: MENU_LIST_ID.cancelar, title: "2. Cancelar consulta" },
        { id: MENU_LIST_ID.remarcar, title: "3. Remarcar consulta" },
        { id: MENU_LIST_ID.informacoes, title: "4. Informações gerais" },
      ],
    },
  ];
}

export function notUnderstoodText(): string {
  return "Não entendi sua resposta 🙏 Escolha uma das opções abaixo.";
}

// Usado enquanto Agendar/Cancelar/Remarcar (cases 1–3) ainda não estão
// implementados no roteador — ver checkpoint do plano.
export function comingSoonText(): string {
  return (
    "Essa opção ainda está sendo implementada por aqui. Enquanto isso, escolha " +
    "[4] Informações gerais > Falar com a secretária para agendar, cancelar ou remarcar sua consulta."
  );
}

export function infoMenuBodyText(): string {
  return "O que você gostaria de saber?";
}

export function infoMenuSections(): ListSection[] {
  return [
    {
      rows: [
        { id: INFO_LIST_ID.valores, title: "1. Valores" },
        { id: INFO_LIST_ID.convenios, title: "2. Convênios" },
        { id: INFO_LIST_ID.endereco, title: "3. Endereço" },
        { id: INFO_LIST_ID.secretaria, title: "4. Falar com secretária" },
      ],
    },
  ];
}

function formatCents(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

interface ClinicLocationRow {
  name: string;
  type: string;
  price_first_visit_cents: number;
  price_return_visit_cents: number;
}

// Decisão de negócio #2/#3 do plano: o bot sempre informa o valor e reforça
// que o pagamento é 100% presencial, sem sinal antecipado.
export function valoresText(locations: ClinicLocationRow[]): string {
  if (locations.length === 0) {
    return "No momento não temos valores cadastrados por aqui — escolha [4] Falar com a secretária para confirmar.";
  }

  const linhas = locations.map((loc) => {
    const label = loc.type === "home_visit" ? "Atendimento domiciliar" : loc.name;
    return `*${label}*\nPrimeira consulta: ${formatCents(loc.price_first_visit_cents)}\nRetorno: ${formatCents(loc.price_return_visit_cents)}`;
  });

  return `${linhas.join("\n\n")}\n\nPagamento no dia da consulta (dinheiro, cartão ou Pix) — sem cobrança antecipada.`;
}

// Decisão de negócio #1 do plano: atendimento particular + recibo para
// reembolso junto ao convênio, quando aplicável.
export function conveniosText(): string {
  return (
    "Atendemos apenas de forma particular, sem convênio. " +
    "Emitimos recibo para você solicitar reembolso junto ao seu convênio, quando aplicável."
  );
}

interface ClinicAddressRow {
  name: string;
  address: string | null;
}

export function enderecoText(clinicLocation: ClinicAddressRow | null): string {
  if (!clinicLocation?.address) {
    return "O endereço do consultório ainda não está cadastrado por aqui — escolha [4] Falar com a secretária para confirmar.";
  }

  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(clinicLocation.address)}`;
  return `*${clinicLocation.name}*\n${clinicLocation.address}\n${mapsUrl}`;
}

export function handoffText(): string {
  return (
    "Combinado! Vou te transferir para a secretária, que responde por aqui assim que possível. " +
    "O atendimento automático fica pausado até lá."
  );
}
