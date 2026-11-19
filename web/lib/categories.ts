// Slugs must match worker/categories.py.
export const CATEGORIES: { slug: string; label: string; short: string }[] = [
  { slug: "dharma", label: "สวดมนต์/ธรรมะ/ทริคชีวิต", short: "ธรรมะ" },
  { slug: "health", label: "สุขภาพ/จิตวิทยา", short: "สุขภาพ" },
  { slug: "law", label: "กฎหมายน่ารู้", short: "กฎหมาย" },
  { slug: "money", label: "เงิน/สิทธิ์", short: "เงิน" },
  { slug: "tech", label: "เทคโนโลยี/AI", short: "เทคโนโลยี" },
  { slug: "news", label: "ข่าวกระแส", short: "ข่าว" },
];

export function catShort(slug: string): string {
  return CATEGORIES.find((c) => c.slug === slug)?.short ?? slug;
}

export function catLabel(slug: string): string {
  return CATEGORIES.find((c) => c.slug === slug)?.label ?? slug;
}
