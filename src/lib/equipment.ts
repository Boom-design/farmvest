/**
 * The equipment types FarmVest stocks.
 *
 * The Admin used to type this in, which made it free text: "Hand Tractor",
 * "hand tractor" and "Kuliglig" were three different types to anything reading
 * the column. That mattered more than it looked, because the weather advisory
 * decides what to recommend from this field, and it was left guessing at the
 * spelling.
 *
 * Each type carries the family it belongs to, so the advisory looks the family
 * up rather than searching the name for a keyword. The list is scoped to
 * small-scale Philippine farming and to a livestock platform: the fleet exists
 * to serve the farms posting projects, not to be a general catalogue.
 */

/** What a unit is for, which is what the weather rules act on. */
export type EquipmentFamily =
  | 'soil'
  | 'planting'
  | 'spray'
  | 'water'
  | 'harvest'
  | 'postharvest'
  | 'livestock'
  | 'transport';

export type EquipmentType = {
  label: string;
  family: EquipmentFamily;
};

/** Grouped the way the Admin thinks about the fleet, and rendered as optgroups. */
export const EQUIPMENT_GROUPS: { group: string; types: EquipmentType[] }[] = [
  {
    group: 'Land Preparation',
    types: [
      { label: 'Hand Tractor', family: 'soil' },
      { label: 'Four-Wheel Tractor', family: 'soil' },
      { label: 'Rotavator', family: 'soil' },
      { label: 'Disc Plow', family: 'soil' },
      { label: 'Disc Harrow', family: 'soil' },
      { label: 'Cultivator', family: 'soil' },
    ],
  },
  {
    group: 'Planting',
    types: [
      { label: 'Rice Transplanter', family: 'planting' },
      { label: 'Corn Planter', family: 'planting' },
      { label: 'Seed Drill', family: 'planting' },
    ],
  },
  {
    group: 'Crop Care',
    types: [
      { label: 'Knapsack Sprayer', family: 'spray' },
      { label: 'Power Sprayer', family: 'spray' },
      { label: 'Mist Blower', family: 'spray' },
      { label: 'Grass Cutter', family: 'soil' },
    ],
  },
  {
    group: 'Water',
    types: [
      { label: 'Water Pump', family: 'water' },
      { label: 'Irrigation Set', family: 'water' },
      { label: 'Sprinkler System', family: 'water' },
    ],
  },
  {
    group: 'Harvest',
    types: [
      { label: 'Combine Harvester', family: 'harvest' },
      { label: 'Reaper', family: 'harvest' },
      { label: 'Corn Harvester', family: 'harvest' },
    ],
  },
  {
    group: 'Post-Harvest',
    types: [
      { label: 'Thresher', family: 'postharvest' },
      { label: 'Corn Sheller', family: 'postharvest' },
      { label: 'Mechanical Dryer', family: 'postharvest' },
      { label: 'Rice Mill', family: 'postharvest' },
    ],
  },
  {
    group: 'Livestock',
    types: [
      { label: 'Feed Mixer', family: 'livestock' },
      { label: 'Feed Grinder', family: 'livestock' },
      { label: 'Forage Chopper', family: 'livestock' },
      { label: 'Egg Incubator', family: 'livestock' },
      { label: 'Milking Machine', family: 'livestock' },
      { label: 'Livestock Weighing Scale', family: 'livestock' },
    ],
  },
  {
    group: 'Hauling and Power',
    types: [
      { label: 'Hauling Trailer', family: 'transport' },
      { label: 'Farm Hauler', family: 'transport' },
      { label: 'Generator Set', family: 'transport' },
    ],
  },
];

/** Flat list, for lookups. */
export const EQUIPMENT_TYPES: EquipmentType[] = EQUIPMENT_GROUPS.flatMap(
  (entry) => entry.types
);

const BY_LABEL = new Map(EQUIPMENT_TYPES.map((type) => [type.label.toLowerCase(), type.family]));

/** Group names in the order the Admin's dropdown lists them. */
export const EQUIPMENT_GROUP_NAMES = EQUIPMENT_GROUPS.map((entry) => entry.group);

const GROUP_BY_LABEL = new Map(
  EQUIPMENT_GROUPS.flatMap((entry) =>
    entry.types.map((type) => [type.label.toLowerCase(), entry.group] as const)
  )
);

/** Which family each group holds, for placing a unit the type does not name. */
const GROUP_BY_FAMILY = new Map(
  EQUIPMENT_GROUPS.flatMap((entry) =>
    entry.types.map((type) => [type.family, entry.group] as const)
  )
);

/**
 * Words that place a unit in a family when its type does not match the list.
 *
 * The fallback for rows entered before the dropdown existed, and for a name
 * that says more than the type does. Kept deliberately short: it is a second
 * chance, not a second source of truth.
 */
const FALLBACK_KEYWORDS: Record<EquipmentFamily, string[]> = {
  soil: ['tractor', 'plow', 'plough', 'harrow', 'tiller', 'rotavator', 'cultivator', 'cutter'],
  planting: ['transplanter', 'planter', 'seeder', 'seed drill'],
  spray: ['sprayer', 'duster', 'mister', 'blower'],
  water: ['pump', 'irrigation', 'sprinkler'],
  harvest: ['harvester', 'reaper'],
  postharvest: ['thresher', 'sheller', 'dryer', 'drier', 'mill'],
  livestock: ['feed', 'mixer', 'grinder', 'chopper', 'incubator', 'milking', 'scale'],
  transport: ['trailer', 'hauler', 'truck', 'generator'],
};

/**
 * Work out what a unit is for.
 *
 * The type is checked against the list first, because that is an exact answer.
 * Only when it is not one of them does the name and type get searched for a
 * keyword, and a unit that matches nothing has no family, which the advisory
 * treats as "no weather rule applies" rather than guessing one.
 */
export const familyOf = (
  name: string,
  type: string | null | undefined
): EquipmentFamily | null => {
  const exact = BY_LABEL.get((type ?? '').trim().toLowerCase());
  if (exact) return exact;

  const haystack = `${name} ${type ?? ''}`.toLowerCase();

  for (const [family, words] of Object.entries(FALLBACK_KEYWORDS)) {
    if (words.some((word) => haystack.includes(word))) return family as EquipmentFamily;
  }

  return null;
};

/**
 * Which group a unit belongs under.
 *
 * The exact type first, then the family the name falls into, so a unit added
 * before the dropdown existed still lands somewhere sensible instead of
 * disappearing from a catalogue that has no All tab to catch it.
 */
export const groupOf = (name: string, type: string | null | undefined): string | null => {
  const exact = GROUP_BY_LABEL.get((type ?? '').trim().toLowerCase());
  if (exact) return exact;

  const family = familyOf(name, type);
  return family ? (GROUP_BY_FAMILY.get(family) ?? null) : null;
};
