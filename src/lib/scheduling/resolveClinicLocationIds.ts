import type { SupabaseClient } from "@supabase/supabase-js";

export type LocationCategory = "clinic" | "home_visit";

// Resolve uma categoria de local ("Consultório" ou "Atendimento domiciliar")
// para os `clinic_location_id`s ativos que a compõem — pode haver mais de
// um consultório físico (2 endereços type='clinic', set/2026). Quem escolhe
// local no bot/admin escolhe a categoria, não um endereço específico; a
// combinação dia/horário escolhida é que decide, na hora de confirmar, qual
// consultório físico atende (ver getAvailableSlotsForDate/getNextAvailableDates,
// que já retornam cada horário com o `clinicLocationId` de origem).
export async function resolveClinicLocationIds(
  supabase: SupabaseClient,
  category: LocationCategory
): Promise<string[]> {
  const { data } = await supabase
    .from("clinic_locations")
    .select("id")
    .eq("type", category)
    .eq("is_active", true);

  return (data ?? []).map((row) => row.id as string);
}
