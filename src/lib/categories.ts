/** Livestock categories a project can be filed under. Mirrors the CHECK constraint on projects.category. */
export const PROJECT_CATEGORIES = ['Poultry', 'Swine', 'Cattle', 'Goat', 'Fish', 'Other'] as const;

export type ProjectCategory = (typeof PROJECT_CATEGORIES)[number];

/**
 * A card with no cover photo still needs to read as its category rather than as
 * a broken image, so each one gets an emoji and a tint to fall back on.
 */
const CATEGORY_LOOK: Record<string, { emoji: string; tint: string }> = {
  Poultry: { emoji: '🐔', tint: '#fef3c7' },
  Swine: { emoji: '🐖', tint: '#fce7f3' },
  Cattle: { emoji: '🐄', tint: '#e0e7ff' },
  Goat: { emoji: '🐐', tint: '#ede9fe' },
  Fish: { emoji: '🐟', tint: '#cffafe' },
  Other: { emoji: '🌾', tint: '#dcfce7' },
};

export const categoryLook = (category: string | null | undefined) =>
  CATEGORY_LOOK[category ?? 'Other'] ?? CATEGORY_LOOK.Other;

/** Equipment type is free text set by the Admin, so its placeholder is one shared icon. */
export const EQUIPMENT_LOOK = { emoji: '🚜', tint: '#e0f2fe' };
