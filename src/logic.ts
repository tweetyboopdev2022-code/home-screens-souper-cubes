// "Chili (4)", "Chili x4", "Chili ×4", "Chili - 4", "Chili: 4" → { name: "Chili", count: 4 }. No number = 0 (to make).
export function parseMeal(content: string): { name: string; count: number } {
  const c = content.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/[*_`]/g, '').trim();
  const m = c.match(/^(.*?)\s*(?:\((\d+)\)|[x×]\s*(\d+)|[-–:]\s*(\d+)|\s(\d+))\s*$/i);
  if (m && m[1].trim()) return { name: m[1].trim(), count: Number(m[2] ?? m[3] ?? m[4] ?? m[5]) };
  return { name: c, count: 0 };
}
export const formatMeal = (name: string, count: number) => `${name} (${Math.max(0, count)})`;
export const tidy = (s: string) => { const t = s.replace(/\s+/g, ' ').trim(); return t ? t[0].toUpperCase() + t.slice(1) : t; };
