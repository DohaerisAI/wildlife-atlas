type Attrs = Record<string, string | number | boolean | EventListener | undefined>;
type Child = Node | string | null | undefined | false;

/** Minimal element builder; text always goes through text nodes, never innerHTML. */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (value === undefined || value === false) continue;
    if (typeof value === 'function') el.addEventListener(name.replace(/^on/, ''), value);
    else if (name === 'class') el.className = String(value);
    else el.setAttribute(name, value === true ? '' : String(value));
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    el.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return el;
}

export function replaceChildren(parent: Element, ...children: Child[]): void {
  parent.replaceChildren(...children.filter((c): c is Node | string => c !== null && c !== undefined && c !== false));
}

export function formatShare(share: number): string {
  if (share >= 0.1) return `${Math.round(share * 100)}%`;
  if (share >= 0.001) return `${(share * 100).toFixed(1)}%`;
  return '<0.1%';
}

export function cellLabel(id: string, size: number): string {
  const [lat, lng] = id.split('_').map(Number) as [number, number];
  const ns = (v: number) => `${Math.abs(v)}°${v >= 0 ? 'N' : 'S'}`;
  const ew = (v: number) => `${Math.abs(v)}°${v >= 0 ? 'E' : 'W'}`;
  return `${ns(lat)}–${ns(lat + size)}, ${ew(lng)}–${ew(lng + size)}`;
}
