import { formatDateOptionLabel } from "../lib/dates";

// `exam_type_id` é um <select> em marcar-exame.astro (o tipo pode ser
// trocado) e um <input type="hidden"> em remarcar-exame.astro (o tipo já
// está fixado pelo exame sendo remarcado) — os dois expõem `.value`, e cada
// opção/input carrega `data-scheduling-mode` ("individual" | "group") pra
// decidir qual fluxo usar sem precisar de outra chamada ao servidor.
const examTypeInput = document.getElementById("exam_type_id") as HTMLSelectElement | HTMLInputElement;
const dateSelect = document.getElementById("date") as HTMLSelectElement;
const slotsContainer = document.getElementById("slots_container") as HTMLDivElement;
const dateWarning = document.getElementById("date_availability_warning") as HTMLParagraphElement;
const submitBtn = document.getElementById("submit_btn") as HTMLButtonElement;
// Local físico único de todo exame (`clinic_locations.type='exam'`) — não
// muda conforme o exame escolhido, por isso vem fixo num data-attribute em
// vez de recalculado a cada troca.
const examLocationId = slotsContainer.dataset.examLocationId ?? "";

function isGroupMode(): boolean {
  if (examTypeInput instanceof HTMLSelectElement) {
    return examTypeInput.selectedOptions[0]?.dataset.schedulingMode === "group";
  }
  return examTypeInput.dataset.schedulingMode === "group";
}

function renderEmptySlots(message: string) {
  slotsContainer.innerHTML = `<p class="text-sm text-slate-500">${message}</p>`;
  submitBtn.disabled = true;
}

function renderGroupSession(option: HTMLOptionElement | undefined) {
  const start = option?.dataset.start;
  if (!start) {
    renderEmptySlots("Nenhuma vaga nesse dia. Escolha outra data.");
    return;
  }

  slotsContainer.innerHTML = "";
  const info = document.createElement("p");
  info.className = "text-sm text-slate-600";
  info.textContent =
    `Esse exame é sempre das ${option.dataset.startLabel} às ${option.dataset.endLabel} — escolha só a data. ` +
    `Vagas: ${option.dataset.remaining}.`;
  const hiddenStart = document.createElement("input");
  hiddenStart.type = "hidden";
  hiddenStart.name = "start";
  hiddenStart.value = `${start}|${examLocationId}`;
  slotsContainer.append(info, hiddenStart);
  submitBtn.disabled = false;
}

async function refreshIndividualSlots() {
  if (!examTypeInput.value || !dateSelect.value) {
    renderEmptySlots("Nenhum horário livre para essa data/exame. Tente outra data.");
    return;
  }

  submitBtn.disabled = false;
  slotsContainer.innerHTML = '<p class="text-sm text-slate-500">Carregando horários…</p>';

  const params = new URLSearchParams({ exam_type_id: examTypeInput.value, date: dateSelect.value });
  const response = await fetch(`/api/admin/agenda/available-exam-slots?${params.toString()}`);
  const { slots } = await response.json();
  slotsContainer.innerHTML = "";

  if (!slots.length) {
    renderEmptySlots("Nenhum horário livre para essa data/exame. Tente outra data.");
    return;
  }

  slots.forEach((slot: { start: string; label: string; clinicLocationId: string }) => {
    const label = document.createElement("label");
    label.className =
      "cursor-pointer rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm font-medium text-slate-700 shadow-sm has-[:checked]:border-sky-700 has-[:checked]:bg-sky-50 has-[:checked]:text-sky-700";
    const input = document.createElement("input");
    input.type = "radio";
    input.name = "start";
    input.value = `${slot.start}|${slot.clinicLocationId}`;
    input.required = true;
    input.className = "mr-1";
    label.appendChild(input);
    label.append(slot.label);
    slotsContainer.appendChild(label);
  });
}

// Datas: pra exame individual, uma data pode ter vários horários (escolhidos
// depois); pra exame em grupo, a data JÁ carrega o horário fixo e as vagas
// (dataset em cada <option>) — só falta ler o que está selecionado.
async function refreshDates() {
  const preferredDate = dateSelect.value;
  dateSelect.innerHTML = "";
  dateSelect.disabled = true;

  if (!examTypeInput.value) {
    renderEmptySlots("Nenhum horário livre para essa data/exame. Tente outra data.");
    return;
  }

  if (isGroupMode()) {
    const params = new URLSearchParams({ exam_type_id: examTypeInput.value });
    const response = await fetch(`/api/admin/agenda/available-exam-group-dates?${params.toString()}`);
    const { sessions } = await response.json();

    const seenDates = new Set<string>();
    const dateOptions: { date: string; startIso: string; startLabel: string; endLabel: string; remaining: number }[] = [];
    for (const session of sessions as { date: string; startTime: string; endTime: string; remainingCapacity: number }[]) {
      if (seenDates.has(session.date)) continue;
      seenDates.add(session.date);
      dateOptions.push({
        date: session.date,
        startIso: new Date(`${session.date}T${session.startTime}:00-03:00`).toISOString(),
        startLabel: session.startTime,
        endLabel: session.endTime,
        remaining: session.remainingCapacity,
      });
    }

    if (!dateOptions.length) {
      dateWarning.classList.remove("hidden");
      renderEmptySlots("Nenhuma vaga nos próximos dias. Tente outro exame.");
      return;
    }

    dateWarning.classList.add("hidden");
    dateSelect.disabled = false;
    dateOptions.forEach((session) => {
      const option = document.createElement("option");
      option.value = session.date;
      option.textContent = formatDateOptionLabel(session.date);
      option.dataset.start = session.startIso;
      option.dataset.startLabel = session.startLabel;
      option.dataset.endLabel = session.endLabel;
      option.dataset.remaining = String(session.remaining);
      dateSelect.appendChild(option);
    });

    if (dateOptions.some((d) => d.date === preferredDate)) dateSelect.value = preferredDate;
    renderGroupSession(dateSelect.selectedOptions[0]);
    return;
  }

  const params = new URLSearchParams({ exam_type_id: examTypeInput.value });
  const response = await fetch(`/api/admin/agenda/available-exam-dates?${params.toString()}`);
  const { dates } = await response.json();

  if (!dates.length) {
    dateWarning.classList.remove("hidden");
    renderEmptySlots("Nenhum horário livre para esse exame nos próximos dias. Fale com a secretária pelo WhatsApp.");
    return;
  }

  dateWarning.classList.add("hidden");
  dateSelect.disabled = false;

  dates.forEach((d: { date: string }) => {
    const option = document.createElement("option");
    option.value = d.date;
    option.textContent = formatDateOptionLabel(d.date);
    dateSelect.appendChild(option);
  });

  if (dates.some((d: { date: string }) => d.date === preferredDate)) {
    dateSelect.value = preferredDate;
  }

  await refreshIndividualSlots();
}

dateSelect.addEventListener("change", () => {
  if (isGroupMode()) {
    renderGroupSession(dateSelect.selectedOptions[0]);
  } else {
    refreshIndividualSlots();
  }
});

if (examTypeInput instanceof HTMLSelectElement) {
  examTypeInput.addEventListener("change", refreshDates);
}
