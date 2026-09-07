import { createClient as createSupabaseClient } from "@supabase/supabase-js";

// Cliente com a service role key: ignora RLS. Uso exclusivo do backend do
// bot de WhatsApp (webhook), que roda sem sessão de usuário autenticado —
// é a Meta chamando o servidor, não a médica/secretária logada.
// NUNCA importar este módulo em código que roda no browser.
export function createServiceClient() {
  return createSupabaseClient(
    import.meta.env.PUBLIC_SUPABASE_URL,
    import.meta.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } }
  );
}
