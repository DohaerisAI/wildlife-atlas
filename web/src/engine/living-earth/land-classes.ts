/**
 * Land class palette for the hologram look (style guide tokens). Index = R channel of land.png
 * (docs/plans/atlas-v2.md). Amber stays reserved for animals: no class uses it at full strength.
 */
export interface LandClass { readonly name: string; readonly color: string; readonly strength: number; readonly green: boolean }

export const LAND_CLASSES: readonly LandClass[] = [
  { name: 'Ocean', color: '#062033', strength: 0, green: false },
  { name: 'Forest', color: '#73f0b8', strength: 1, green: true },
  { name: 'Shrubland', color: '#a9d98a', strength: 0.75, green: true },
  { name: 'Grassland', color: '#b9ef72', strength: 0.85, green: true },
  { name: 'Cropland', color: '#d6e889', strength: 0.7, green: true },
  { name: 'Built-up', color: '#d9f2ff', strength: 0.55, green: false },
  { name: 'Bare ground', color: '#d7b279', strength: 0.55, green: false },
  { name: 'Snow and ice', color: '#d9f2ff', strength: 0.8, green: false },
  { name: 'Water', color: '#62d6f2', strength: 0.9, green: false },
  { name: 'Wetland', color: '#62d6f2', strength: 0.8, green: true },
  { name: 'Mangrove', color: '#5fe0c4', strength: 0.9, green: true },
  { name: 'Moss and lichen', color: '#9fc9b0', strength: 0.5, green: false },
];

/** Palette as a flat RGB float array for a shader uniform (vec3 per class). */
export function paletteArray(classes: readonly LandClass[] = LAND_CLASSES): Float32Array {
  const out = new Float32Array(classes.length * 3);
  classes.forEach((c, i) => {
    const n = parseInt(c.color.slice(1), 16);
    out.set([((n >> 16) & 255) / 255 * c.strength, ((n >> 8) & 255) / 255 * c.strength, (n & 255) / 255 * c.strength], i * 3);
  });
  return out;
}

export const className = (i: number): string => LAND_CLASSES[i]?.name ?? 'Unknown';
