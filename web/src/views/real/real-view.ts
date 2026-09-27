import {
  Cartesian2, Cartesian3, Color, ColorGeometryInstanceAttribute, Credit, EllipsoidTerrainProvider, GeometryInstance, ImageryLayer,
  GroundPrimitive, Ion, JulianDate, Math as CMath, PerInstanceColorAppearance, PointPrimitive, PointPrimitiveCollection, Polyline, PolylineCollection,
  Primitive, Rectangle, RectangleGeometry, ScreenSpaceEventHandler, ScreenSpaceEventType, Terrain, UrlTemplateImageryProvider, Viewer,
  Material,
} from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import { cellIntensity, sampleFlow } from '../../scene/flow';
import { effectivePitch, type CameraTarget, type SceneView, type SpeciesLayer } from '../../scene/view';

const ESRI_IMAGERY = 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const PARTICLE_HEIGHT_M = 9500; // above the highest Himalayan peaks, so terrain never hides the flow
const TRAIL_LAG_MONTHS = 0.09;
const MAX_TRAILS = 1500;
const PARTICLE_COLOR = Color.fromCssColorString('#ffb36b');
const CELL_COLOR = Color.fromCssColorString('#ff8a3d');
const YEAR = 2025;

function createViewer(container: HTMLElement): Viewer {
  const token = import.meta.env.VITE_CESIUM_ION_TOKEN as string | undefined;
  if (token) Ion.defaultAccessToken = token;
  const imagery = new UrlTemplateImageryProvider({
    url: ESRI_IMAGERY, maximumLevel: 18,
    credit: new Credit('Imagery © Esri, Maxar, Earthstar Geographics'),
  });
  const viewer = new Viewer(container, {
    baseLayer: new ImageryLayer(imagery),
    terrain: token ? Terrain.fromWorldTerrain({ requestVertexNormals: true }) : undefined,
    terrainProvider: token ? undefined : new EllipsoidTerrainProvider(),
    baseLayerPicker: false, geocoder: false, homeButton: false, sceneModePicker: false, navigationHelpButton: false,
    animation: false, timeline: false, fullscreenButton: false, infoBox: false, selectionIndicator: false,
  });
  const { scene } = viewer;
  scene.globe.enableLighting = true;
  scene.globe.dynamicAtmosphereLighting = true;
  scene.globe.depthTestAgainstTerrain = false;
  scene.highDynamicRange = true;
  viewer.clock.shouldAnimate = false;
  return viewer;
}

/** Map fractional month to a real date at 07:00 UTC (midday over India) so sunlight matches the season. */
export function monthToJulian(t: number): JulianDate {
  const start = Date.UTC(YEAR, 0, 1, 7);
  const dayOfYear = Math.floor((((t % 12) + 12) % 12) / 12 * 365);
  return JulianDate.fromDate(new Date(start + dayOfYear * 86400000));
}

class RealSpecies {
  private readonly points: PointPrimitiveCollection;
  private readonly trails: PolylineCollection;
  private readonly pointList: PointPrimitive[] = [];
  private readonly trailList: Polyline[] = [];
  private readonly cells: GroundPrimitive | Primitive;
  private readonly cellIds: string[];
  private readonly now: Float32Array;
  private readonly prev: Float32Array;
  private readonly scratch = new Color();

  constructor(private readonly viewer: Viewer, private readonly layer: SpeciesLayer) {
    const n = layer.flow.count;
    this.now = new Float32Array(n * 3);
    this.prev = new Float32Array(n * 3);
    this.points = viewer.scene.primitives.add(new PointPrimitiveCollection());
    this.trails = viewer.scene.primitives.add(new PolylineCollection());
    const trailMaterial = Material.fromType('Color', { color: PARTICLE_COLOR.withAlpha(0.22) });
    for (let i = 0; i < n; i++) {
      this.pointList.push(this.points.add({ position: Cartesian3.ZERO, pixelSize: 2.4, color: PARTICLE_COLOR, outlineColor: PARTICLE_COLOR.withAlpha(0.18), outlineWidth: 1.5 }));
      if (i < MAX_TRAILS) this.trailList.push(this.trails.add({ positions: [Cartesian3.ZERO, Cartesian3.ZERO], width: 1.0, material: trailMaterial }));
    }
    this.cellIds = Object.keys(layer.range.cells);
    const onTerrain = !(viewer.terrainProvider instanceof EllipsoidTerrainProvider);
    const CellPrimitive = onTerrain ? GroundPrimitive : Primitive;
    this.cells = viewer.scene.primitives.add(new CellPrimitive({
      geometryInstances: this.cellIds.map((id) => {
        const [lat, lng] = id.split('_').map(Number) as [number, number];
        const s = layer.cellSize;
        return new GeometryInstance({
          id,
          geometry: new RectangleGeometry({ rectangle: Rectangle.fromDegrees(lng + 0.04, lat + 0.04, lng + s - 0.04, lat + s - 0.04), height: onTerrain ? undefined : 1500 }),
          attributes: { color: ColorGeometryInstanceAttribute.fromColor(CELL_COLOR.withAlpha(0)) },
        });
      }),
      appearance: new PerInstanceColorAppearance({ flat: true, translucent: true }),
      asynchronous: onTerrain,
    }));
  }

  update(t: number): void {
    const { flow } = this.layer;
    sampleFlow(flow, t, this.now, 0.18);
    sampleFlow(flow, t - TRAIL_LAG_MONTHS, this.prev, 0.18);
    for (let i = 0; i < flow.count; i++) {
      const a = this.now[i * 3 + 2]!;
      const p = this.pointList[i]!;
      p.show = a > 0.02;
      if (!p.show) { if (this.trailList[i]) this.trailList[i]!.show = false; continue; }
      p.position = Cartesian3.fromDegrees(this.now[i * 3]!, this.now[i * 3 + 1]!, PARTICLE_HEIGHT_M);
      p.color = Color.clone(PARTICLE_COLOR, this.scratch).withAlpha(a * 0.75);
      const trail = this.trailList[i];
      if (trail) {
        trail.show = true;
        trail.positions = [Cartesian3.fromDegrees(this.prev[i * 3]!, this.prev[i * 3 + 1]!, PARTICLE_HEIGHT_M), p.position];
      }
    }
    const intensity = cellIntensity(this.layer.range, t, this.layer.peak);
    for (const id of this.cellIds) {
      if (!this.cells.ready) break;
      const attrs = this.cells.getGeometryInstanceAttributes(id);
      if (attrs) attrs.color = ColorGeometryInstanceAttribute.toValue(CELL_COLOR.withAlpha(Math.min(0.28, (intensity.get(id) ?? 0) * 0.28)), attrs.color);
    }
  }

  dispose(): void {
    const prims = this.viewer.scene.primitives;
    for (const p of [this.points, this.trails, this.cells]) prims.remove(p);
  }
}

export function createRealView(container: HTMLElement): SceneView {
  const viewer = createViewer(container);
  let species: RealSpecies | null = null;
  const pickHandlers: ((lng: number, lat: number) => void)[] = [];

  const handler = new ScreenSpaceEventHandler(viewer.scene.canvas);
  handler.setInputAction((e: { position: Cartesian2 }) => {
    const hit = viewer.camera.pickEllipsoid(e.position, viewer.scene.globe.ellipsoid);
    if (!hit) return;
    const c = viewer.scene.globe.ellipsoid.cartesianToCartographic(hit);
    pickHandlers.forEach((fn) => fn(CMath.toDegrees(c.longitude), CMath.toDegrees(c.latitude)));
  }, ScreenSpaceEventType.LEFT_CLICK);

  const destination = (target: CameraTarget) => {
    const pitch = effectivePitch(target.altitudeKm, target.pitch);
    // Tilted views look at the target from the south, so offset the camera position.
    const back = pitch > -85 ? (target.altitudeKm / 111) * Math.tan(CMath.toRadians(90 + pitch)) : 0;
    return Cartesian3.fromDegrees(target.lng, target.lat - back, target.altitudeKm * 1000);
  };

  return {
    setSpecies(layer) {
      species?.dispose();
      species = layer ? new RealSpecies(viewer, layer) : null;
    },
    update(t) {
      viewer.clock.currentTime = monthToJulian(t);
      species?.update(t);
    },
    flyTo(target, durationMs) {
      const orientation = { heading: 0, pitch: CMath.toRadians(effectivePitch(target.altitudeKm, target.pitch)), roll: 0 };
      if (durationMs <= 0) viewer.camera.setView({ destination: destination(target), orientation });
      else viewer.camera.flyTo({ destination: destination(target), orientation, duration: durationMs / 1000 });
    },
    camera() {
      const c = viewer.camera.positionCartographic;
      return { lng: CMath.toDegrees(c.longitude), lat: CMath.toDegrees(c.latitude), altitudeKm: c.height / 1000 };
    },
    onPick(cb) { pickHandlers.push(cb); },
    dispose() {
      handler.destroy();
      species?.dispose();
      viewer.destroy();
    },
  };
}
