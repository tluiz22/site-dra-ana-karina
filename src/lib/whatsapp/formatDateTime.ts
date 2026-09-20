// Formatação de data/hora de consulta em texto de WhatsApp — compartilhada
// entre as notificações (Fase 3a) e o bot (Fase 3b), para manter o mesmo
// formato em toda mensagem que o paciente recebe.

export const TIMEZONE = "America/Fortaleza";

// "21/08/2026 às 14h00" (fuso do consultório, não do servidor).
export function formatWhen(date: Date): string {
  const datePart = new Intl.DateTimeFormat("pt-BR", {
    timeZone: TIMEZONE,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);

  const timePart = new Intl.DateTimeFormat("pt-BR", {
    timeZone: TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
    .format(date)
    .replace(":", "h");

  return `${datePart} às ${timePart}`;
}
