import type { PerspectiveCamera } from 'three';
import { EARTH_KM, lngLatToVec3 } from './geo';

/** Where the camera is: above a point, at an altitude, with the globe shifted sideways for text. */
export interface CameraPose {
  readonly lng: number;
  readonly lat: number;
  readonly altKm: number;
  /** Globe centre offset from the screen centre as a fraction of width (+ moves the globe right). */
  readonly frameX: number;
}

const wrapDeg = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180;

/** Frame-rate independent critically-damped-style approach toward `target`, taking the short way round in longitude. */
export function dampPose(current: CameraPose, target: CameraPose, dt: number, rate = 3.2): CameraPose {
  const k = 1 - Math.exp(-rate * dt);
  const dLng = wrapDeg(target.lng - current.lng);
  return {
    lng: wrapDeg(current.lng + dLng * k),
    lat: current.lat + (target.lat - current.lat) * k,
    // altitude moves in log space so zooming feels even at every scale
    altKm: Math.exp(Math.log(current.altKm) + (Math.log(target.altKm) - Math.log(current.altKm)) * k),
    frameX: current.frameX + (target.frameX - current.frameX) * k,
  };
}

export const poseDistance = (altKm: number) => 1 + altKm / EARTH_KM;

export function applyPose(camera: PerspectiveCamera, pose: CameraPose, width: number, height: number): void {
  camera.position.copy(lngLatToVec3(pose.lng, pose.lat, poseDistance(pose.altKm)));
  camera.up.set(0, 1, 0);
  camera.lookAt(0, 0, 0);
  camera.setViewOffset(width, height, -pose.frameX * width, 0, width, height);
}
