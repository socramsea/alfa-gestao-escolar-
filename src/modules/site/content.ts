import { z } from 'zod';

const text = (max: number) => z.string().trim().max(max);
const imageId = z.string().uuid().nullable().optional();

/** Conteúdo editável do site público da escola. */
export const siteContentSchema = z
  .object({
    hero: z.object({ title: text(120).min(1), subtitle: text(300).default(''), image_id: imageId }).strict(),
    about: z.object({ title: text(120).default('Sobre a escola'), text: text(3000).default('') }).strict(),
    highlights: z.array(z.object({ title: text(80).min(1), text: text(400).default('') }).strict()).max(8).default([]),
    routine: z.array(z.object({ title: text(80).min(1), text: text(600).default('') }).strict()).max(12).default([]),
    segments: z
      .array(
        z
          .object({
            name: text(60).min(1),
            ages: text(60).default(''),
            shifts: text(80).default(''),
            description: text(600).default(''),
          })
          .strict(),
      )
      .max(12)
      .default([]),
    uniform: z
      .object({
        intro: text(1000).default(''),
        where_to_buy: text(400).default(''),
        items: z
          .array(
            z
              .object({
                name: text(80).min(1),
                description: text(400).default(''),
                price: text(30).default(''),
                required: z.boolean().default(true),
                image_id: imageId,
              })
              .strict(),
          )
          .max(24)
          .default([]),
      })
      .strict()
      .default({}),
    faq: z.array(z.object({ question: text(200).min(1), answer: text(1500).min(1) }).strict()).max(40).default([]),
    enrollment: z
      .object({
        open: z.boolean().default(true),
        year: z.number().int().min(2000).max(2100).optional(),
        intro: text(600).default(''),
      })
      .strict()
      .default({}),
    contact: z
      .object({
        whatsapp: text(20).default(''),
        email: text(160).default(''),
        instagram: text(60).default(''),
      })
      .strict()
      .default({}),
  })
  .strict();

export type SiteContent = z.infer<typeof siteContentSchema>;

export function collectImageIds(content: SiteContent) {
  return [content.hero.image_id, ...content.uniform.items.map((item) => item.image_id)].filter(
    (id): id is string => Boolean(id),
  );
}
