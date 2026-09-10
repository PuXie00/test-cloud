/** Aspect-aware frustum compensation so shared camera framing stays consistent across differently sized canvases (contain). */

export const resolveOrthoContainHalf = (
  refHalfHeight: number,
  aspect: number,
  refAspect: number,
): number => {
  const safeAspect = aspect > 0 ? aspect : 1;
  const safeRefAspect = refAspect > 0 ? refAspect : 1;
  const refHalfH = Math.max(0.5, refHalfHeight);
  const refHalfW = refHalfH * safeRefAspect;
  return Math.max(refHalfH, refHalfW / safeAspect);
};

/** Recover reference half-height from an already contain-compensated orthoTop. */
export const invertOrthoContainHalf = (
  appliedHalfHeight: number,
  aspect: number,
  refAspect: number,
): number => {
  const safeAspect = aspect > 0 ? aspect : 1;
  const safeRefAspect = refAspect > 0 ? refAspect : 1;
  const applied = Math.max(0.5, appliedHalfHeight);
  if (safeAspect < safeRefAspect) {
    return Math.max(0.5, (applied * safeAspect) / safeRefAspect);
  }
  return applied;
};

/**
 * Scale factor for perspective radius so the reference horizontal FOV still fits
 * when the canvas is narrower than refAspect. Wider canvases keep scale=1.
 */
export const perspectiveContainScale = (
  aspect: number,
  refAspect: number,
  verticalFovRad: number,
): number => {
  const safeAspect = aspect > 0 ? aspect : 1;
  const safeRefAspect = refAspect > 0 ? refAspect : 1;
  if (safeAspect >= safeRefAspect) {
    return 1;
  }
  const halfV = verticalFovRad / 2;
  const tanHalfV = Math.tan(halfV);
  if (!(tanHalfV > 0)) {
    return 1;
  }
  const neededHalfV = Math.atan((tanHalfV * safeRefAspect) / safeAspect);
  return Math.tan(neededHalfV) / tanHalfV;
};
