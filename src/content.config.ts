import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const blog = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/blog' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    pubDate: z.coerce.date(),
    category: z.string(),
    draft: z.boolean().default(false),
  }),
});

const guias = defineCollection({
  loader: glob({ pattern: '**/*.mdx', base: './src/content/guias' }),
  schema: z.object({
    title: z.string(),
    subtitle: z.string(),
    description: z.string(),
    condition: z.string(),
    pubDate: z.coerce.date(),
    updatedDate: z.coerce.date().optional(),
    pdfFile: z.string(),
    draft: z.boolean().default(false),
  }),
});

export const collections = { blog, guias };
