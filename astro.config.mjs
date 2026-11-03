import { defineConfig, fontProviders } from "astro/config";
import tailwindcss from "@tailwindcss/vite";
import sitemap from "@astrojs/sitemap";
import mdx from "@astrojs/mdx";

const site =
  process.env.SITE_URL ??
  (process.env.VERCEL_ENV === "production"
    ? "https://draanakarinapneumo.com.br"
    : process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "http://localhost:4321");

export default defineConfig({
  site,
  integrations: [sitemap(), mdx()],
  // Fontes baixadas no build e servidas pelo próprio domínio (REDESIGN_SPEC §2.1).
  // Sem itálico: a citação da seção "Sobre" ainda não foi aprovada pela médica.
  fonts: [
    {
      provider: fontProviders.fontsource(),
      name: "Newsreader",
      cssVariable: "--font-newsreader",
      weights: ["400 500"],
      styles: ["normal"],
      subsets: ["latin"],
      fallbacks: ["Georgia", "serif"],
    },
    {
      provider: fontProviders.fontsource(),
      name: "Figtree",
      cssVariable: "--font-figtree",
      weights: ["400 600"],
      styles: ["normal"],
      subsets: ["latin"],
      fallbacks: ["system-ui", "sans-serif"],
    },
  ],
  vite: {
    plugins: [tailwindcss()],
  },
});
