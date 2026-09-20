// Feriados nacionais do Brasil — usado para nunca oferecer data de feriado
// na agenda (nem nas sugestões automáticas, nem numa data escolhida
// manualmente). Cobre só feriados nacionais fixados em lei federal:
// Carnaval e Corpus Christi ficam de fora de propósito, pois são "pontos
// facultativos" nacionalmente, não feriados obrigatórios (ver plano).

const FIXED_HOLIDAYS: ReadonlyArray<readonly [month: number, day: number]> = [
  [1, 1], // Confraternização Universal
  [4, 21], // Tiradentes
  [5, 1], // Dia do Trabalho
  [9, 7], // Independência do Brasil
  [10, 12], // Nossa Senhora Aparecida
  [11, 2], // Finados
  [11, 15], // Proclamação da República
  [11, 20], // Dia Nacional de Zumbi e da Consciência Negra (federal desde 2023)
  [12, 25], // Natal
];

// Domingo de Páscoa pelo algoritmo de Meeus/Jones/Butcher (calendário
// gregoriano) — usado para achar a Sexta-feira Santa, único feriado móvel
// que é nacional por lei (Carnaval e Corpus Christi não são).
function easterSunday(year: number): { month: number; day: number } {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return { month, day };
}

function shiftMonthDay(year: number, month: number, day: number, deltaDays: number): { month: number; day: number } {
  const d = new Date(Date.UTC(year, month - 1, day));
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return { month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

// `isoDate` no formato "yyyy-mm-dd" (mesmo usado no resto do módulo de
// agendamento — sem hora/fuso, é uma data corrida, não um instante).
export function isNationalHoliday(isoDate: string): boolean {
  const [yearStr, monthStr, dayStr] = isoDate.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);

  if (FIXED_HOLIDAYS.some(([m, d]) => m === month && d === day)) return true;

  const easter = easterSunday(year);
  const goodFriday = shiftMonthDay(year, easter.month, easter.day, -2);
  return goodFriday.month === month && goodFriday.day === day;
}
