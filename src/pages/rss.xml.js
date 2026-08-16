import rss from "@astrojs/rss";
import { getCollection } from "astro:content";
import { doctor } from "../data/doctor";

export async function GET(context) {
  const posts = await getCollection("blog", ({ data }) => !data.draft);

  return rss({
    title: `Blog | ${doctor.professionalName}`,
    description: "Conteúdo educativo sobre saúde respiratória infantil.",
    site: context.site,
    items: posts
      .sort((a, b) => b.data.pubDate.valueOf() - a.data.pubDate.valueOf())
      .map((post) => ({
        title: post.data.title,
        description: post.data.description,
        pubDate: post.data.pubDate,
        link: `/blog/${post.id}/`,
      })),
  });
}
