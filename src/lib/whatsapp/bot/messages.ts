// Textos e menus do bot de WhatsApp (Fase 3b). Mantido separado do roteador
// (`./router.ts`) para deixar o conteúdo das mensagens fácil de revisar e
// ajustar sem mexer na lógica de estados.

import type { ListSection } from "../client";
import { formatWhen } from "../formatDateTime";
import { formatCentsBRL } from "../../money";
import { BACK_TO_MENU_LIST_ID } from "./shared";

const DOCTOR_NAME = "Dra. Ana Karina Fernandes";

// A Meta rejeita a mensagem inteira (erro 131009 "Parameter value is not
// valid") se o título de uma linha de lista passar de 24 caracteres — já
// aconteceu com "1. Instituto Andre Camurça" (26) e pode acontecer de novo
// com nome de paciente comprido. Central pra nunca mais estourar o limite.
const MAX_LIST_ROW_TITLE = 24;

function listRowTitle(index: number, label: string): string {
  const prefix = `${index + 1}. `;
  const maxLabelLength = MAX_LIST_ROW_TITLE - prefix.length;
  const truncated = label.length > maxLabelLength ? `${label.slice(0, maxLabelLength - 1)}…` : label;
  return `${prefix}${truncated}`;
}

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
        { id: MENU_LIST_ID.agendar, title: listRowTitle(0, "Agendar consulta") },
        { id: MENU_LIST_ID.cancelar, title: listRowTitle(1, "Cancelar consulta") },
        { id: MENU_LIST_ID.remarcar, title: listRowTitle(2, "Remarcar consulta") },
        { id: MENU_LIST_ID.informacoes, title: listRowTitle(3, "Informações gerais") },
      ],
    },
  ];
}

export function notUnderstoodText(): string {
  return "Não entendi sua resposta 🙏 Escolha uma das opções abaixo (ou digite 0 para voltar ao menu principal).";
}

export function infoMenuBodyText(): string {
  return "O que você gostaria de saber?";
}

export function infoMenuSections(): ListSection[] {
  return [
    {
      rows: [
        { id: INFO_LIST_ID.valores, title: listRowTitle(0, "Valores") },
        { id: INFO_LIST_ID.convenios, title: listRowTitle(1, "Convênios") },
        { id: INFO_LIST_ID.endereco, title: listRowTitle(2, "Endereço") },
        { id: INFO_LIST_ID.secretaria, title: listRowTitle(3, "Falar com secretária") },
        { id: BACK_TO_MENU_LIST_ID, title: listRowTitle(4, "Voltar ao menu") },
      ],
    },
  ];
}

interface ClinicLocationRow {
  name: string;
  type: string;
  price_first_visit_cents: number;
}

// Decisão de negócio #2/#3 do plano: o bot sempre informa o valor e reforça
// que o pagamento é 100% presencial, sem sinal antecipado.
export function valoresText(locations: ClinicLocationRow[]): string {
  if (locations.length === 0) {
    return "No momento não temos valores cadastrados por aqui — escolha [4] Falar com a secretária para confirmar.";
  }

  const linhas = locations.map((loc) => {
    const label = loc.type === "home_visit" ? "Atendimento domiciliar" : loc.name;
    return `*${label}*\nConsulta: ${formatCentsBRL(loc.price_first_visit_cents)}`;
  });

  return (
    `${linhas.join("\n\n")}\n\n` +
    "O retorno está incluso no valor da consulta.\n\n" +
    "Pagamento no dia da consulta (dinheiro, transferência bancária ou PIX) — sem cobrança antecipada."
  );
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

// Lista todos os consultórios cadastrados (não só um) — preparado para
// quando houver mais de um endereço físico de consultório (ver "Backlog
// futuro" no plano). Como a data escolhida decide para qual consultório a
// consulta vai, o texto deixa claro que o endereço definitivo só é
// confirmado depois, na mensagem de confirmação.
export function enderecoText(clinicLocations: ClinicAddressRow[]): string {
  const withAddress = clinicLocations.filter(
    (loc): loc is ClinicAddressRow & { address: string } => !!loc.address
  );

  if (withAddress.length === 0) {
    return "O endereço do consultório ainda não está cadastrado por aqui — escolha [4] Falar com a secretária para confirmar.";
  }

  const linhas = withAddress.map((loc) => {
    const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(loc.address)}`;
    return `*${loc.name}*\n${loc.address}\n${mapsUrl}`;
  });

  const intro = withAddress.length > 1 ? "Temos os seguintes consultórios:" : null;
  const outro =
    "O endereço da sua consulta será confirmado na mensagem de confirmação, de acordo com a data escolhida.";

  return [intro, ...linhas, outro].filter(Boolean).join("\n\n");
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
        { id: MODALITY_LIST_ID.firstVisit, title: listRowTitle(0, "Consulta") },
        { id: MODALITY_LIST_ID.returnVisit, title: listRowTitle(1, "Retorno") },
        { id: BACK_TO_MENU_LIST_ID, title: listRowTitle(2, "Voltar ao menu") },
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
  const rows = options.map((opt, index) => ({
    id: `book_location_${opt.id}`,
    title: listRowTitle(index, opt.label),
  }));
  rows.push({ id: BACK_TO_MENU_LIST_ID, title: listRowTitle(options.length, "Voltar ao menu") });
  return [{ rows }];
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
    title: listRowTitle(index, c.full_name),
  }));
  rows.push({ id: PATIENT_NEW_LIST_ID, title: listRowTitle(candidates.length, "Outra criança") });
  rows.push({ id: BACK_TO_MENU_LIST_ID, title: listRowTitle(candidates.length + 1, "Voltar ao menu") });
  return [{ rows }];
}

export function askBirthdateText(): string {
  return (
    "Encontramos várias crianças cadastradas nesse telefone. " +
    "Qual a data de nascimento da criança? (formato dd/mm/aaaa)"
  );
}

// Usado ao cadastrar uma criança nova, antes de pedir o nome — evita
// duplicar o cadastro de uma criança já existente (sem consulta futura)
// com o nome digitado de um jeito ligeiramente diferente.
export function askBirthdateForDuplicateCheckText(): string {
  return (
    "Para não duplicar o cadastro, qual é a data de nascimento da criança? " +
    "(formato dd/mm/aaaa)"
  );
}

export function birthdateMatchChoiceBodyText(): string {
  return "Encontramos crianças já cadastradas com essa data de nascimento nesse telefone. É uma delas?";
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
  const rows = candidates.map((c, index) => ({
    id: `${idPrefix}_${c.id}`,
    title: listRowTitle(index, c.patient_name),
    description: formatWhen(new Date(c.scheduled_at)),
  }));
  rows.push({ id: BACK_TO_MENU_LIST_ID, title: listRowTitle(candidates.length, "Voltar ao menu"), description: "" });
  return [{ rows }];
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
