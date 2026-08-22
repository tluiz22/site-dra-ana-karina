import type { APIRoute } from "astro";
import { createClient } from "../../../../lib/supabase/server";

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const formData = await request.formData();
  const email = formData.get("email")?.toString();
  const password = formData.get("password")?.toString();

  if (!email || !password) {
    return redirect("/admin/login?error=1");
  }

  const supabase = createClient(request, cookies);
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    return redirect("/admin/login?error=1");
  }

  return redirect("/admin/dashboard");
};
