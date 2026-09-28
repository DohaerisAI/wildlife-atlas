import type { PerspectiveCamera } from 'three';
import { Vector3 } from 'three';
import { lngLatToVec3 } from '../globe/geo';

interface Pin { el: HTMLElement; lng: number; lat: number; opacity: number }

/** HTML labels pinned to places on the globe; hidden when a place turns to the far side. */
export class LabelLayer {
  private readonly pins = new Map<string, Pin>();
  private readonly v = new Vector3();
  private readonly n = new Vector3();

  constructor(private readonly root: HTMLElement) {}

  upsert(id: string, text: string, lng: number, lat: number, kind: 'place' | 'animal' = 'place'): void {
    let pin = this.pins.get(id);
    if (!pin) {
      const el = document.createElement('div');
      el.className = `pin pin-${kind}`;
      el.setAttribute('aria-hidden', 'true');
      this.root.appendChild(el);
      pin = { el, lng, lat, opacity: 0 };
      this.pins.set(id, pin);
    }
    if (pin.el.textContent !== text) pin.el.textContent = text;
    pin.lng = lng; pin.lat = lat;
  }

  setOpacity(id: string, opacity: number): void {
    const pin = this.pins.get(id); if (pin) pin.opacity = opacity;
  }

  update(camera: PerspectiveCamera, width: number, height: number): void {
    for (const pin of this.pins.values()) {
      lngLatToVec3(pin.lng, pin.lat, 1.01, this.v);
      this.n.copy(this.v).normalize();
      const facing = this.n.dot(this.v.clone().sub(camera.position).normalize().negate());
      this.v.project(camera);
      const x = (this.v.x * 0.5 + 0.5) * width;
      const y = (-this.v.y * 0.5 + 0.5) * height;
      const vis = facing > 0.15 ? pin.opacity : 0;
      pin.el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
      pin.el.style.opacity = vis.toFixed(3);
    }
  }

  dispose(): void { this.pins.forEach((p) => p.el.remove()); this.pins.clear(); }
}
