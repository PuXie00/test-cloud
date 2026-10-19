import type { ActionSequenceConfig, TimelineMarker } from "@/app/project/action-sequence/types";
import { snapTimeMs } from "./timeline/timeline-data";

const MARKER_NAME_PREFIX = "标记";

export const MARKER_NAME_MAX_LENGTH = 20;

/** 输入时按字符截到上限 */
export const clampMarkerName = (value: string): string =>
  [...value].slice(0, MARKER_NAME_MAX_LENGTH).join("");

/** 按时刻排好的标记；同一时刻按名称 */
export const sortedMarkers = (sequence: Pick<ActionSequenceConfig, "markers">): TimelineMarker[] =>
  [...(sequence.markers ?? [])].sort(
    (left, right) => left.atMs - right.atMs || left.name.localeCompare(right.name, "zh"),
  );

/** 新标记的默认名：「标记 N」，N 取没用过的最小序号 */
export const nextMarkerName = (markers: readonly TimelineMarker[]): string => {
  const used = new Set(markers.map((marker) => marker.name));
  let index = 1;
  while (used.has(`${MARKER_NAME_PREFIX} ${index}`)) index += 1;
  return `${MARKER_NAME_PREFIX} ${index}`;
};

export const newMarkerId = (markers: readonly TimelineMarker[]): string => {
  const used = new Set(markers.map((marker) => marker.id));
  let id = "";
  do {
    id = `mkr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  } while (used.has(id));
  return id;
};

const withMarkers = (
  sequence: ActionSequenceConfig,
  markers: TimelineMarker[],
): ActionSequenceConfig => ({ ...sequence, markers });

/** 在某个时刻加一个标记（按 0.1 s 取整） */
export const addMarker = (
  sequence: ActionSequenceConfig,
  marker: Pick<TimelineMarker, "id" | "atMs"> & { name?: string },
): ActionSequenceConfig => {
  const markers = sequence.markers ?? [];
  return withMarkers(sequence, [
    ...markers,
    {
      id: marker.id,
      atMs: snapTimeMs(marker.atMs),
      name: clampMarkerName(marker.name?.trim() ?? "") || nextMarkerName(markers),
    },
  ]);
};

/** 改名；名称为空时不改 */
export const renameMarker = (
  sequence: ActionSequenceConfig,
  markerId: string,
  name: string,
): ActionSequenceConfig => {
  const trimmed = clampMarkerName(name.trim());
  const markers = sequence.markers ?? [];
  const current = markers.find((marker) => marker.id === markerId);
  if (!trimmed || !current || current.name === trimmed) return sequence;
  return withMarkers(
    sequence,
    markers.map((marker) => (marker.id === markerId ? { ...marker, name: trimmed } : marker)),
  );
};

export const setMarkerTime = (
  sequence: ActionSequenceConfig,
  markerId: string,
  atMs: number,
): ActionSequenceConfig => {
  const next = snapTimeMs(atMs);
  const markers = sequence.markers ?? [];
  const current = markers.find((marker) => marker.id === markerId);
  if (!current || current.atMs === next) return sequence;
  return withMarkers(
    sequence,
    markers.map((marker) => (marker.id === markerId ? { ...marker, atMs: next } : marker)),
  );
};

/** 拖动一组标记：相对拖动开始时的序列平移，最早的那个不早于 0 */
export const shiftMarkers = (
  origin: ActionSequenceConfig,
  markerIds: readonly string[],
  deltaMs: number,
): ActionSequenceConfig => {
  const ids = new Set(markerIds);
  const markers = origin.markers ?? [];
  const moving = markers.filter((marker) => ids.has(marker.id));
  if (moving.length === 0) return origin;
  const delta = Math.max(deltaMs, -Math.min(...moving.map((marker) => marker.atMs)));
  return withMarkers(
    origin,
    markers.map((marker) =>
      ids.has(marker.id) ? { ...marker, atMs: snapTimeMs(marker.atMs + delta) } : marker,
    ),
  );
};

export const deleteMarkers = (
  sequence: ActionSequenceConfig,
  markerIds: readonly string[],
): ActionSequenceConfig => {
  const ids = new Set(markerIds);
  const markers = sequence.markers ?? [];
  const kept = markers.filter((marker) => !ids.has(marker.id));
  if (kept.length === markers.length) return sequence;
  return withMarkers(sequence, kept);
};
