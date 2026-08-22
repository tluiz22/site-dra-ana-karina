import { defineMiddleware } from "astro:middleware";
import { createClient } from "./lib/supabase/server";

export const onRequest = defineMiddleware(async (context, next) => {
  const { url, request, cookies, redirect } = context;

  const isAdminPath = url.pathname.startsWith("/admin") || url.pathname.startsWith("/api/admin");
  const isPublicAdminPath =
    url.pathname === "/admin/login" || url.pathname === "/api/admin/auth/login";

  if (!isAdminPath || isPublicAdminPath) {
    return next();
  }

  const supabase = createClient(request, cookies);
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return redirect("/admin/login");
  }

  return next();
});
