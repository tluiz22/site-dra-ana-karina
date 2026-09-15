// Textos e menus do bot de WhatsApp (Fase 3b). Mantido separado do roteador
// (`./router.ts`) para deixar o conteúdo das mensagens fácil de revisar e
// ajustar sem mexer na lógica de estados.

import type { ListSection } from "../client";
import { formatWhen } from "../formatDateTime";

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
    return `*${label}*\nConsulta: ${formatCents(loc.price_first_visit_cents)}\nRetorno: ${formatCents(loc.price_return_visit_cents)}`;
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

// --- case 1 · Agendar -------------------------------------------------

export const MODALITY_LIST_ID = {
  firstVisit: "book_modality_first",
  returnVisit: "book_modality_return",
} as const;

export function modalityBodyText(): string {
  return "Vamos agendar! Você quer marcar uma consulta ou um retorno?";
}

export function modalitySections(): ListSection[] {
  return [
    {
      rows: [
        { id: MODALITY_LIST_ID.firstVisit, title: "1. Consulta" },
        { id: MODALITY_LIST_ID.returnVisit, title: "2. Retorno" },
      ],
    },
  ];
}

export interface LocationOption {
  id: string;
  label: string;
}

export function locationBodyText(): string {
  return "Prefere consultório ou atendimento domiciliar?";
}

export function locationSections(options: LocationOption[]): ListSection[] {
  return [
    {
      rows: options.map((opt, index) => ({
        id: `book_location_${opt.id}`,
        title: `${index + 1}. ${opt.label}`,
      })),
    },
  ];
}

export function noLocationAvailableText(): string {
  return "No momento não temos nenhum local de atendimento configurado — escolha [4] Falar com a secretária no menu principal.";
}

interface PatientCandidate {
  id: string;
  full_name: string;
}

export function patientChoiceBodyText(): string {
  return "Encontramos consultas futuras para estas crianças. Para qual delas é o agendamento?";
}

export const PATIENT_NEW_LIST_ID = "book_patient_new";

export function patientChoiceSections(candidates: PatientCandidate[]): ListSection[] {
  const rows = candidates.map((c, index) => ({
    id: `book_patient_${c.id}`,
    title: `${index + 1}. ${c.full_name}`,
  }));
  rows.push({ id: PATIENT_NEW_LIST_ID, title: `${candidates.length + 1}. Outra criança` });
  return [{ rows }];
}

export function askBirthdateText(): string {
  return (
    "Encontramos várias crianças cadastradas nesse telefone. " +
    "Qual a data de nascimento da criança? (formato dd/mm/aaaa)"
  );
}

export function invalidBirthdateText(): string {
  return "Não consegui entender essa data. Por favor, digite no formato dd/mm/aaaa (ex.: 10/03/2020).";
}

export function confirmPatientText(fullName: string, birthdateLabel: string): string {
  return `Encontramos *${fullName}*, nascido(a) em ${birthdateLabel} — é essa a criança? Responda Sim ou Não.`;
}

export function notUnderstoodYesNoText(): string {
  return "Não entendi 🙏 Responda apenas Sim ou Não.";
}

export function askGuardianNameText(): string {
  return "Antes de continuar, qual é o seu nome completo (responsável pela criança)?";
}

export function askNewPatientNameText(): string {
  return "Qual é o nome completo da criança?";
}

export function askNewPatientBirthdateText(): string {
  return "Qual a data de nascimento da criança? (formato dd/mm/aaaa)";
}

export function bookingLinkText(patientName: string, url: string): string {
  return (
    `Prontinho! Escolha o melhor dia e horário para a consulta de ${patientName} neste link:\n${url}\n\n` +
    "O link expira em 30 minutos."
  );
}

export function bookingLinkErrorText(): string {
  return "Tivemos um problema para gerar o link de agendamento. Por favor, escolha [4] Falar com a secretária no menu principal.";
}

// --- identificação de consulta futura (compartilhada pelos cases 2 e 3) --
//
// Mesmo princípio anti-convênio do case 1 · Agendar: nunca listar às cegas
// todas as consultas de um responsável (ver "Identificação da criança" no
// plano). Usado tanto por Cancelar (bot/cancel.ts) quanto por Remarcar
// (bot/reschedule.ts).

interface AppointmentCandidate {
  id: string;
  patient_name: string;
  scheduled_at: string;
}

export function appointmentChoiceBodyText(action: "remarcar" | "cancelar"): string {
  return `Qual consulta você quer ${action}?`;
}

export function appointmentListSections(candidates: AppointmentCandidate[], idPrefix: string): ListSection[] {
  return [
    {
      rows: candidates.map((c, index) => ({
        id: `${idPrefix}_${c.id}`,
        title: `${index + 1}. ${c.patient_name}`,
        description: formatWhen(new Date(c.scheduled_at)),
      })),
    },
  ];
}

export function noMatchingAppointmentText(): string {
  return "Não encontramos consulta futura para essa data de nascimento. Escolha [4] Falar com a secretária no menu principal se precisar de ajuda.";
}

export function couldNotIdentifyAppointmentText(): string {
  return "Não conseguimos confirmar qual consulta é. Escolha [4] Falar com a secretária no menu principal.";
}

// --- case 3 · Remarcar --------------------------------------------------

export function rescheduleNoGuardianText(): string {
  return "Não encontramos nenhum cadastro associado a este número. Se você já é paciente, escolha [4] Falar com a secretária no menu principal.";
}

export function rescheduleNoAppointmentsText(): string {
  return "Não encontramos nenhuma consulta futura para remarcar neste número. Escolha [4] Falar com a secretária no menu principal se precisar de ajuda.";
}

export function confirmAppointmentText(patientName: string, whenLabel: string): string {
  return `Encontramos a consulta de *${patientName}* em ${whenLabel} — é essa que você quer remarcar? Responda Sim ou Não.`;
}

export function rescheduleLinkText(patientName: string, url: string): string {
  return (
    `Prontinho! Escolha o novo dia e horário para a consulta de ${patientName} neste link:\n${url}\n\n` +
    "O link expira em 30 minutos."
  );
}

export function rescheduleLinkErrorText(): string {
  return "Tivemos um problema para gerar o link de remarcação. Por favor, escolha [4] Falar com a secretária no menu principal.";
}

// --- case 2 · Cancelar ----------------------------------------------------

export function cancelNoGuardianText(): string {
  return "Não encontramos nenhum cadastro associado a este número. Se você já é paciente, escolha [4] Falar com a secretária no menu principal.";
}

export function cancelNoAppointmentsText(): string {
  return "Não encontramos nenhuma consulta futura para cancelar neste número. Escolha [4] Falar com a secretária no menu principal se precisar de ajuda.";
}

export function confirmCancelText(patientName: string, whenLabel: string): string {
  return `Confirma o cancelamento da consulta de *${patientName}* em ${whenLabel}? Responda Sim ou Não.`;
}

export function cancelAbortedText(): string {
  return "Ok, mantivemos sua consulta marcada.";
}

export function cancelSuccessText(patientName: string, whenLabel: string): string {
  return (
    `Prontinho, cancelamos a consulta de ${patientName} que estava marcada para ${whenLabel}. ` +
    "Se precisar marcar uma nova consulta, é só me chamar de novo."
  );
}

export function cancelErrorText(): string {
  return "Tivemos um problema para cancelar a consulta. Por favor, escolha [4] Falar com a secretária no menu principal.";
}
