import { formatDateOptionLabel } from "../lib/dates";

const locationSelect = document.getElementById("location_category") as HTMLSelectElement;
const dateSelect = document.getElementById("date") as HTMLSelectElement;
const typeSelect = document.getElementById("appointment_type") as HTMLSelectElement;
const slotsContainer = document.getElementById("slots_container") as HTMLDivElement;
const dateWarning = document.getElementById("date_availability_warning") as HTMLParagraphElement;
const submitBtn = document.getElementById("submit_btn") as HTMLButtonElement;

function renderEmptySlots(message: string) {
  slotsContainer.innerHTML = `<p class="text-sm text-slate-500">${message}</p>`;
  submitBtn.disabled = true;
}

async function refreshSlots() {
  if (!dateSelect.value) {
    renderEmptySlots("Nenhum horário livre para essa data/local. Tente outra data.");
    return;
  }

  submitBtn.disabled = false;
  slotsContainer.innerHTML = '<p class="text-sm text-slate-500">Carregando horários…</p>';

  const params = new URLSearchParams({
    location_category: locationSelect.value,
    date: dateSelect.value,
    appointment_type: typeSelect.value,
  });

  const response = await fetch(`/api/admin/agenda/available-slots?${params.toString()}`);
  const { slots } = await response.json();
  slotsContainer.innerHTML = "";

  if (!slots.length) {
    renderEmptySlots("Nenhum horário livre para essa data/local. Tente outra data.");
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

// Local/tipo mudam quais datas têm horário livre — refaz a lista de datas
// (não só os horários do dia) sempre que um dos dois muda.
async function refreshDates() {
  const preferredDate = dateSelect.value;
  dateSelect.innerHTML = "";
  dateSelect.disabled = true;

  const params = new URLSearchParams({
    location_category: locationSelect.value,
    appointment_type: typeSelect.value,
  });
  const response = await fetch(`/api/admin/agenda/available-dates?${params.toString()}`);
  const { dates } = await response.json();

  if (!dates.length) {
    dateWarning.classList.remove("hidden");
    renderEmptySlots("Nenhum horário livre para essa data/local. Tente outra data.");
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

  await refreshSlots();
}

locationSelect.addEventListener("change", refreshDates);
typeSelect.addEventListener("change", refreshDates);
dateSelect.addEventListener("change", refreshSlots);
