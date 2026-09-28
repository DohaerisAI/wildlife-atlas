export const globeVertex = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vView;
  varying vec3 vPos;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vPos = position;
    vNormal = normalize(normalMatrix * normal);
    vView = normalize(-(viewMatrix * world).xyz);
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

export const globeFragment = /* glsl */ `
  uniform float uTime;
  uniform vec3 uCore;
  uniform vec3 uRim;
  varying vec3 vNormal;
  varying vec3 vView;
  varying vec3 vPos;
  void main() {
    float fres = pow(1.0 - max(dot(vNormal, vView), 0.0), 2.6);
    vec3 p = normalize(vPos);
    float lat = degrees(asin(p.y));
    float lng = degrees(atan(p.z, -p.x));
    float gLat = 1.0 - smoothstep(0.0, 0.12, abs(fract(lat / 10.0 + 0.5) - 0.5) * 10.0);
    float gLng = 1.0 - smoothstep(0.0, 0.12, abs(fract(lng / 10.0 + 0.5) - 0.5) * 10.0);
    float grid = max(gLat, gLng) * 0.12;
    float scan = 0.012 * (0.5 + 0.5 * sin(p.y * 160.0 - uTime * 1.2));
    vec3 col = uCore + uRim * (fres * 0.55 + grid + scan);
    gl_FragColor = vec4(col, 1.0);
  }
`;

export const atmosphereFragment = /* glsl */ `
  uniform vec3 uRim;
  varying vec3 vNormal;
  void main() {
    // Rendered on the back side of a slightly larger sphere: glow peaks just outside the limb.
    float i = pow(max(0.62 - dot(vNormal, vec3(0.0, 0.0, 1.0)), 0.0), 6.0);
    gl_FragColor = vec4(uRim, 1.0) * clamp(i * 3.0, 0.0, 1.0);
  }
`;

export const particleVertex = /* glsl */ `
  attribute float alpha;
  uniform float uSize;
  uniform float uPixelRatio;
  varying float vAlpha;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vAlpha = alpha;
    gl_PointSize = uSize * uPixelRatio * (1.0 / -mv.z);
    gl_Position = projectionMatrix * mv;
  }
`;

export const particleFragment = /* glsl */ `
  uniform vec3 uColor;
  varying float vAlpha;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c);
    float core = smoothstep(0.5, 0.0, d);
    float a = core * core * vAlpha * 0.6;
    if (a < 0.01) discard;
    gl_FragColor = vec4(uColor * (0.5 + 0.8 * core), a);
  }
`;

export const trailVertex = /* glsl */ `
  attribute float alpha;
  varying float vAlpha;
  void main() {
    vAlpha = alpha;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const trailFragment = /* glsl */ `
  uniform vec3 uColor;
  varying float vAlpha;
  void main() {
    gl_FragColor = vec4(uColor, vAlpha * 0.3);
  }
`;
