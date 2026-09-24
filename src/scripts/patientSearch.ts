import { formatPhoneBR } from "../lib/phone";

const searchInput = document.getElementById("patient_search") as HTMLInputElement;
const hiddenInput = document.getElementById("patient_id") as HTMLInputElement;
const resultsBox = document.getElementById("patient_results") as HTMLDivElement;
const warningBox = document.getElementById("patient_warning") as HTMLParagraphElement;
const clearBtn = document.getElementById("patient_clear") as HTMLButtonElement;
const form = searchInput.closest("form") as HTMLFormElement;

// marcar-exame.astro passa esses data-attributes pra reaproveitar o mesmo
// script com o texto certo (consulta fala em "consulta futura", exame fala
// no tipo de exame) e pra escopar a busca por categoria.
const category = searchInput.dataset.searchCategory ?? "";
const alreadyScheduledListSuffix = searchInput.dataset.alreadyScheduledListSuffix ?? "já tem consulta futura";
const alreadyScheduledMessage =
  searchInput.dataset.alreadyScheduledMessage ?? "Este paciente já tem uma consulta futura marcada.";

let debounceTimer: ReturnType<typeof setTimeout>;

function hideWarning() {
  warningBox.classList.add("hidden");
}

function showWarning(message: string) {
  warningBox.textContent = message;
  warningBox.classList.remove("hidden");
}

function updateClearButton() {
  clearBtn.classList.toggle("hidden", !hiddenInput.value);
}

function resetSelection() {
  hiddenInput.value = "";
  hideWarning();
  updateClearButton();
}

// Evita ter que apagar o nome escolhido letra por letra pra buscar de novo.
function clearField() {
  searchInput.value = "";
  resultsBox.innerHTML = "";
  resetSelection();
  searchInput.focus();
}

clearBtn.addEventListener("click", clearField);

// Sem `required` nativo no input de busca (o campo real, `patient_id`, é
// hidden e o navegador não valida hidden) — o aviso mora no `patient_warning`,
// que empurra o layout em vez de sobrepor a lista de resultados como o
// balão nativo do navegador fazia.
form.addEventListener("submit", (event) => {
  if (!hiddenInput.value) {
    event.preventDefault();
    showWarning("Selecione um paciente da lista de resultados.");
    searchInput.focus();
  }
});

searchInput.addEventListener("input", () => {
  resetSelection();
  clearTimeout(debounceTimer);
  const q = searchInput.value.trim();

  if (q.length < 2) {
    resultsBox.innerHTML = "";
    return;
  }

  debounceTimer = setTimeout(async () => {
    const params = new URLSearchParams({ q });
    if (category) params.set("category", category);
    const response = await fetch(`/api/admin/pacientes/search?${params.toString()}`);
    const patients = await response.json();
    resultsBox.innerHTML = "";

    patients.forEach(
      (patient: {
        id: string;
        full_name: string;
        guardian_name: string;
        guardian_phone: string;
        has_upcoming_appointment: boolean;
      }) => {
        const item = document.createElement("button");
        item.type = "button";
        item.className =
          "block w-full border-t border-slate-100 px-3 py-2 text-left text-sm first:border-t-0 hover:bg-slate-100";
        const label = `${patient.full_name} — resp. ${patient.guardian_name} (${formatPhoneBR(patient.guardian_phone)})`;
        item.textContent = patient.has_upcoming_appointment ? `${label} ⚠ ${alreadyScheduledListSuffix}` : label;
        item.addEventListener("click", () => {
          hiddenInput.value = patient.id;
          searchInput.value = label;
          resultsBox.innerHTML = "";
          updateClearButton();
          if (patient.has_upcoming_appointment) {
            showWarning(alreadyScheduledMessage);
          } else {
            hideWarning();
          }
        });
        resultsBox.appendChild(item);
      }
    );
  }, 300);
});

updateClearButton();
