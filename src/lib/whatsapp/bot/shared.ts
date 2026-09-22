// Helpers compartilhados entre o webhook (`src/pages/api/whatsapp/webhook.ts`)
// e os módulos da máquina de estados (`./router.ts`, `./booking.ts`, ...).

import type { SupabaseClient } from "@supabase/supabase-js";
import { TIMEZONE } from "../formatDateTime";

// "5584981880777" (formato da Meta) → "+5584981880777".
export function toE164(waFrom: string | undefined): string | null {
  if (!waFrom || !/^\d{10,15}$/.test(waFrom)) return null;
  return `+${normalizeBrazilianMobileDigits(waFrom)}`;
}

// A Meta às vezes reporta o `wa_id`/`from` de um número brasileiro sem o "9"
// extra que celulares têm (herança da transição de 8 para 9 dígitos no
// Brasil, ainda inconsistente em alguns clientes do WhatsApp) — ex.:
// "556198645490" (12 dígitos: 55 + DDD + 8) em vez de "5561998645490" (13:
// 55 + DDD + 9 + 8). Sem normalizar, o mesmo número vira duas linhas
// diferentes em `conversation_state`/`guardians` dependendo de quem manda o
// webhook — foi exatamente esse bug que fez os resets de teste da Fase 3b
// nunca "colarem" na conversa real. Assume-se celular (não fixo) porque só
// o app do WhatsApp gera mensagens inbound.
function normalizeBrazilianMobileDigits(digits: string): string {
  if (digits.startsWith("55") && digits.length === 12) {
    const ddd = digits.slice(2, 4);
    const local = digits.slice(4);
    return `55${ddd}9${local}`;
  }
  return digits;
}

export async function resolveGuardianId(
  supabase: SupabaseClient,
  phoneE164: string
): Promise<string | null> {
  const { data } = await supabase
    .from("guardians")
    .select("id")
    .eq("phone", phoneE164)
    .eq("is_active", true)
    .maybeSingle();
  return data?.id ?? null;
}

// Devolve a conversa ao bot: a palavra-chave `#bot` enviada pela secretária
// pelo app do WhatsApp Business (detectada no echo `smb_message_echoes`)
// desliga `atendimento_humano` e volta o estado para MENU — ver "Coexistência"
// e "Máquina de estados" no plano (Fase 3b).
export async function returnControlToBot(
  supabase: SupabaseClient,
  guardianPhone: string
): Promise<void> {
  const { error } = await supabase
    .from("conversation_state")
    .update({ atendimento_humano: false, state: "MENU", context: {} })
    .eq("guardian_phone", guardianPhone);
  if (error) {
    console.error("[whatsapp bot] erro ao devolver conversa ao bot:", error.message);
  }
}

// Prazo do transbordo para a secretária: 24h corridas, mas nunca vencendo
// num fim de semana — se cair no sábado ou domingo, empurra pra segunda no
// mesmo horário. Não considera feriados (fora de escopo por ora). Passado o
// prazo, a próxima mensagem do responsável devolve a conversa ao bot
// automaticamente, sem depender da secretária lembrar de digitar `#bot`.
export function isPastHumanHandoffDeadline(handoffAt: Date, now: Date = new Date()): boolean {
  const deadline = new Date(handoffAt.getTime() + 24 * 60 * 60 * 1000);
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone: TIMEZONE, weekday: "short" }).format(deadline);
  if (weekday === "Sat") deadline.setDate(deadline.getDate() + 2);
  else if (weekday === "Sun") deadline.setDate(deadline.getDate() + 1);
  return now.getTime() >= deadline.getTime();
}

// Timeout de inatividade: sem cron dedicado (o único Vercel Cron do projeto
// roda 1x/dia, para o lembrete de consulta), o reset é lazy, no mesmo padrão
// do prazo de transbordo acima — só é avaliado quando uma nova mensagem
// chega. Se a conversa ficou parada num estado intermediário (fora de
// WELCOME/MENU, que não têm sub-fluxo/contexto a perder) por mais que esse
// tempo, reinicia do zero em vez de tentar reencaixar a mensagem num
// contexto que o responsável provavelmente já esqueceu. Valor fácil de
// ajustar.
export const IDLE_TIMEOUT_MINUTES = 15;

export function isPastIdleTimeout(lastUpdatedAt: Date, now: Date = new Date()): boolean {
  return now.getTime() - lastUpdatedAt.getTime() >= IDLE_TIMEOUT_MINUTES * 60 * 1000;
}

// Base pública do site, para montar o link de `/agendar/[token]` enviado
// pelo bot. Mesma lógica de fallback do `astro.config.mjs` (site institucional
// em produção, preview da Vercel, ou localhost em dev) — só que resolvida em
// runtime, já que o webhook roda como função de servidor.
export function resolveSiteUrl(): string {
  const explicit = import.meta.env.SITE_URL as string | undefined;
  if (explicit) return explicit.replace(/\/$/, "");

  const vercelEnv = import.meta.env.VERCEL_ENV as string | undefined;
  if (vercelEnv === "production") return "https://draanakarinapneumo.com.br";

  const vercelUrl = import.meta.env.VERCEL_URL as string | undefined;
  if (vercelUrl) return `https://${vercelUrl}`;

  return "http://localhost:4321";
}

// Monta uma URL pública do site (link de agendar/remarcar enviado por
// WhatsApp) a partir de `resolveSiteUrl()`. Tolera o caso de teste em que
// `SITE_URL` já vem com query string (ex.: `?x-vercel-protection-bypass=...`,
// usado para destravar um preview protegido pela Vercel durante a Fase 3b) —
// nesse caso o path entra antes da query, não depois.
export function buildAppUrl(path: string): string {
  const base = resolveSiteUrl();
  const [origin, existingQuery] = base.split("?");
  const url = `${origin}${path}`;
  return existingQuery ? `${url}?${existingQuery}` : url;
}

// --- resposta do usuário (toque em lista ou texto digitado) ---------------

export interface Selection {
  id: string | null;
  text: string;
}

// Opção "voltar ao menu principal", incluída em todas as listas do bot (ver
// `router.ts`, que intercepta essa seleção antes de qualquer estado
// específico — funciona em qualquer ponto da conversa, inclusive nos
// prompts de texto livre como nome/data de nascimento).
export const BACK_TO_MENU_LIST_ID = "back_to_menu";

export function isBackToMenuSelection(selection: Selection): boolean {
  if (selection.id === BACK_TO_MENU_LIST_ID) return true;
  const normalized = selection.text.trim().toLowerCase();
  return normalized === "0" || normalized === "menu" || normalized === "menu principal";
}

export function extractSelection(waMsg: {
  text?: { body?: string };
  interactive?: {
    list_reply?: { id?: string; title?: string };
    button_reply?: { id?: string; title?: string };
  };
  button?: { text?: string };
}): Selection {
  const id = waMsg.interactive?.list_reply?.id ?? waMsg.interactive?.button_reply?.id ?? null;
  const text = (
    waMsg.text?.body ??
    waMsg.interactive?.list_reply?.title ??
    waMsg.interactive?.button_reply?.title ??
    waMsg.button?.text ??
    ""
  ).trim();
  return { id, text };
}

// Aceita tanto o toque na lista interativa (`selection.id`) quanto o
// paciente digitando o número diretamente (ex.: "1" ou "1. Agendar").
export function matchesOption(selection: Selection, digit: string, listId: string): boolean {
  if (selection.id === listId) return true;
  const normalized = selection.text.toLowerCase();
  return normalized === digit || normalized.startsWith(`${digit}.`) || normalized.startsWith(`${digit} `);
}

// Resolve uma lista dinâmica (candidatos de criança, consultas a remarcar,
// ...) tanto pelo `id` da lista interativa quanto pelo dígito digitado
// (posição 1-based na mesma ordem em que as opções foram enviadas).
export function resolveByListOrDigit<T>(
  selection: Selection,
  list: T[],
  idBuilder: (item: T) => string
): T | null {
  if (selection.id) {
    const found = list.find((item) => idBuilder(item) === selection.id);
    if (found) return found;
  }
  const index = Number.parseInt(selection.text.trim(), 10);
  if (Number.isInteger(index) && index >= 1 && index <= list.length) return list[index - 1];
  return null;
}

// --- estado da conversa -----------------------------------------------

export async function updateConversationState(
  supabase: SupabaseClient,
  guardianPhone: string,
  state: string,
  extra: Record<string, unknown> = {}
): Promise<void> {
  const { error } = await supabase
    .from("conversation_state")
    .update({ state, updated_at: new Date().toISOString(), ...extra })
    .eq("guardian_phone", guardianPhone);
  if (error) {
    console.error("[whatsapp bot] erro ao atualizar conversation_state:", error.message);
  }
}

// --- envio + log ---------------------------------------------------------

export async function sendAndLog(
  supabase: SupabaseClient,
  guardianId: string | null,
  messageType: string,
  bodyForLog: string,
  send: () => Promise<{ id: string }>
): Promise<void> {
  try {
    const { id } = await send();
    await logOutbound(supabase, guardianId, messageType, bodyForLog, id, "sent");
  } catch (err) {
    console.error(
      `[whatsapp bot] falha ao enviar ${messageType}:`,
      err instanceof Error ? err.message : String(err)
    );
    await logOutbound(supabase, guardianId, messageType, bodyForLog, null, "failed");
  }
}

// --- consultas futuras de um responsável (cases 2 e 3) --------------------
//
// Mesmo princípio anti-convênio do case 1 · Agendar: a lista completa fica
// no `conversation_state.context` e cada chamador (cancel.ts/reschedule.ts)
// decide como apresentá-la (lista direta até 3, ou pergunta a data de
// nascimento acima disso) — ver "Identificação da criança" no plano.

export interface AppointmentCandidate {
  id: string;
  patient_id: string;
  patient_name: string;
  birthdate: string;
  scheduled_at: string;
  clinic_location_id: string;
  appointment_type: "first_visit" | "return_visit" | "exam";
  exam_type_id: string | null;
  google_event_id: string | null;
}

export async function fetchUpcomingAppointments(
  supabase: SupabaseClient,
  guardianId: string
): Promise<AppointmentCandidate[]> {
  const nowIso = new Date().toISOString();
  const { data: rows } = await supabase
    .from("appointments")
    .select(
      "id, scheduled_at, clinic_location_id, appointment_type, exam_type_id, google_event_id, patient_id, patients!inner(full_name, birthdate, guardian_id)"
    )
    .eq("patients.guardian_id", guardianId)
    .in("status", ["scheduled", "confirmed"])
    .gt("scheduled_at", nowIso)
    .order("scheduled_at", { ascending: true });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (rows ?? []).map((row: any) => ({
    id: row.id,
    patient_id: row.patient_id,
    patient_name: row.patients?.full_name ?? "Paciente",
    birthdate: row.patients?.birthdate ?? "",
    scheduled_at: row.scheduled_at,
    clinic_location_id: row.clinic_location_id,
    appointment_type: row.appointment_type,
    exam_type_id: row.exam_type_id ?? null,
    google_event_id: row.google_event_id ?? null,
  }));
}

// --- data de nascimento (usada nos cases 1 e 3 para identificar a criança) -

// "10/03/2020" → "2020-03-10". Recusa datas impossíveis (ex. 31/02) e datas
// futuras (data de nascimento não pode estar no futuro).
export function parseBirthdateInput(text: string): string | null {
  const match = text.trim().match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (!match) return null;

  const day = Number.parseInt(match[1], 10);
  const month = Number.parseInt(match[2], 10);
  const year = Number.parseInt(match[3], 10);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  const date = new Date(Date.UTC(year, month - 1, day));
  const isRealDate =
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  if (!isRealDate || date.getTime() > Date.now()) return null;

  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function formatBirthdateLabel(isoDate: string): string {
  const [year, month, day] = isoDate.split("-");
  return `${day}/${month}/${year}`;
}

async function logOutbound(
  supabase: SupabaseClient,
  guardianId: string | null,
  messageType: string,
  body: string,
  waMessageId: string | null,
  status: string
): Promise<void> {
  const { error } = await supabase.from("whatsapp_messages").insert({
    guardian_id: guardianId,
    direction: "outbound",
    message_type: messageType,
    body,
    status,
    wa_message_id: waMessageId,
  });
  if (error) {
    console.error("[whatsapp bot] erro ao registrar mensagem de saída:", error.message);
  }
}
