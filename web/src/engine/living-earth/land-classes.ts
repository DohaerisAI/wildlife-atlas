/**
 * Land class palette for the hologram look (style guide tokens). Index = R channel of land.png
 * (docs/plans/atlas-v2.md). Amber stays reserved for animals: no class uses it at full strength.
 */
export interface LandClass { readonly name: string; readonly color: string; readonly strength: number; readonly green: boolean }

export const LAND_CLASSES: readonly LandClass[] = [
  { name: 'Ocean', color: '#062033', strength: 0, green: false },
  { name: 'Forest', color: '#2fe07e', strength: 1, green: true },
  { name: 'Shrubland', color: '#9ccc5a', strength: 0.8, green: true },
  { name: 'Grassland', color: '#c3f25e', strength: 0.9, green: true },
  { name: 'Cropland', color: '#c2d67a', strength: 0.75, green: true },
  { name: 'Built-up', color: '#9fb4c6', strength: 0.5, green: false },
  { name: 'Bare ground', color: '#bdb39c', strength: 0.7, green: false },
  { name: 'Snow and ice', color: '#eaf7ff', strength: 0.9, green: false },
  { name: 'Water', color: '#62d6f2', strength: 0.9, green: false },
  { name: 'Wetland', color: '#46d6c8', strength: 0.85, green: true },
  { name: 'Mangrove', color: '#1fd6a4', strength: 0.95, green: true },
  { name: 'Moss and lichen', color: '#8fb8a4', strength: 0.55, green: false },
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
