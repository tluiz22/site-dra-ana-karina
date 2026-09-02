const locationSelect = document.getElementById("clinic_location_id") as HTMLSelectElement;
const dateInput = document.getElementById("date") as HTMLInputElement;
const typeSelect = document.getElementById("appointment_type") as HTMLSelectElement;
const slotsContainer = document.getElementById("slots_container") as HTMLDivElement;
const dateWarning = document.getElementById("date_availability_warning") as HTMLParagraphElement;
const submitBtn = document.getElementById("submit_btn") as HTMLButtonElement;
const availableWeekdaysByLocation = (window as any).__availableWeekdaysByLocation as Record<string, number[]>;

function weekdayInFortaleza(dateStr: string): number {
  return new Date(`${dateStr}T00:00:00-03:00`).getUTCDay();
}

function isLocationAvailableOnDate(): boolean {
  if (!locationSelect.value || !dateInput.value) return true;
  const weekdays = availableWeekdaysByLocation[locationSelect.value] ?? [];
  return weekdays.includes(weekdayInFortaleza(dateInput.value));
}

function showDateUnavailableWarning() {
  dateWarning.textContent = "Não há atendimento nesse local nesse dia da semana. Escolha outra data.";
  dateWarning.classList.remove("hidden");
  submitBtn.disabled = true;
  slotsContainer.innerHTML = "";
}

async function refreshSlots() {
  if (!locationSelect.value || !dateInput.value) return;

  if (!isLocationAvailableOnDate()) {
    showDateUnavailableWarning();
    return;
  }

  dateWarning.classList.add("hidden");
  submitBtn.disabled = false;

  slotsContainer.innerHTML = '<p class="text-sm text-slate-500">Carregando horários…</p>';

  const params = new URLSearchParams({
    clinic_location_id: locationSelect.value,
    date: dateInput.value,
    appointment_type: typeSelect.value,
  });

  const response = await fetch(`/api/admin/agenda/available-slots?${params.toString()}`);
  const { slots } = await response.json();
  slotsContainer.innerHTML = "";

  if (!slots.length) {
    slotsContainer.innerHTML =
      '<p class="text-sm text-slate-500">Nenhum horário livre para essa data/local. Tente outra data.</p>';
    return;
  }

  slots.forEach((slot: { start: string; label: string }) => {
    const label = document.createElement("label");
    label.className =
      "cursor-pointer rounded-md border border-slate-300 px-3 py-2 text-sm has-[:checked]:border-sky-700 has-[:checked]:bg-sky-50";
    const input = document.createElement("input");
    input.type = "radio";
    input.name = "start";
    input.value = slot.start;
    input.required = true;
    input.className = "mr-1";
    label.appendChild(input);
    label.append(slot.label);
    slotsContainer.appendChild(label);
  });
}

if (!isLocationAvailableOnDate()) showDateUnavailableWarning();

locationSelect.addEventListener("change", refreshSlots);
dateInput.addEventListener("change", refreshSlots);
typeSelect.addEventListener("change", refreshSlots);
