// Idade legível a partir de uma data de nascimento (YYYY-MM-DD), relativa a
// uma data de referência (também YYYY-MM-DD — evita qualquer ambiguidade de
// fuso horário, os dois são datas puras, sem hora). Detalhada pra bebês e
// crianças pequenas (contexto pediátrico, onde meses importam), simples a
// partir de 3 anos.
export function formatAge(birthdateIso: string, referenceDateIso: string): string {
  const [by, bm, bd] = birthdateIso.split("-").map(Number);
  const [ry, rm, rd] = referenceDateIso.split("-").map(Number);

  let years = ry - by;
  let months = rm - bm;
  if (rd < bd) months -= 1;
  if (months < 0) {
    years -= 1;
    months += 12;
  }

  if (years < 1) {
    if (months < 1) {
      const totalDays = Math.max(0, Math.round((Date.UTC(ry, rm - 1, rd) - Date.UTC(by, bm - 1, bd)) / 86_400_000));
      return totalDays === 1 ? "1 dia" : `${totalDays} dias`;
    }
    return months === 1 ? "1 mês" : `${months} meses`;
  }

  if (years < 3) {
    const yearLabel = years === 1 ? "1 ano" : `${years} anos`;
    if (months === 0) return yearLabel;
    const monthLabel = months === 1 ? "1 mês" : `${months} meses`;
    return `${yearLabel} e ${monthLabel}`;
  }

  return years === 1 ? "1 ano" : `${years} anos`;
}
