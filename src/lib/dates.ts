export function formatDateBR(dateStr: string): string {
  const [year, month, day] = dateStr.split("-");
  return `${day}/${month}/${year}`;
}

export function formatWeekdayFull(dateStr: string): string {
  const label = new Intl.DateTimeFormat("pt-BR", { weekday: "long", timeZone: "America/Fortaleza" }).format(
    new Date(`${dateStr}T12:00:00-03:00`)
  );
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function formatDateOptionLabel(dateStr: string): string {
  return `${formatWeekdayFull(dateStr)}, ${formatDateBR(dateStr)}`;
}
