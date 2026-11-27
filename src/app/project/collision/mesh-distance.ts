import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector";

import { finishSteps, type Steps } from "./worker-job";

export type Triangle = [Vector3, Vector3, Vector3];
type Bounds = { min: Vector3; max: Vector3 };
type Tree = Bounds & { count: number; faces?: Triangle[]; children?: [Tree, Tree] };
type Shell = { bounds: Bounds; faces: Triangle[]; closed: boolean };
export type CollisionShape = { tree: Tree; shells: Shell[]; radius: number; box: boolean };

const AXES = ["x", "y", "z"] as const;
const emptyBounds = (): Bounds => ({
  min: new Vector3(Infinity, Infinity, Infinity),
  max: new Vector3(-Infinity, -Infinity, -Infinity),
});
const include = (bounds: Bounds, p: Vector3) => {
  bounds.min.minimizeInPlace(p);
  bounds.max.maximizeInPlace(p);
};
function* boundsOf(faces: Triangle[]): Steps<Bounds> {
  const bounds = emptyBounds();
  for (let i = 0; i < faces.length; i++) {
    if (i % 256 === 0) yield;
    for (const vertex of faces[i]) include(bounds, vertex);
  }
  return bounds;
};
/** Stable runs keep even the largest BVH split interruptible without changing face order. */
function* sortFaces(faces: Triangle[], center: (face: Triangle) => number): Steps<void> {
  const runSize = 512;
  if (faces.length <= runSize) {
    faces.sort((a, b) => center(a) - center(b));
    return;
  }
  const buffer: Triangle[] = [];
  for (let i = 0; i < faces.length; i += runSize) {
    yield;
    const run = faces.slice(i, i + runSize).sort((a, b) => center(a) - center(b));
    for (let j = 0; j < run.length; j++) faces[i + j] = run[j];
  }
  for (let size = runSize; size < faces.length; size *= 2) {
    for (let i = 0; i < faces.length; i += 2 * size) {
      const middle = Math.min(i + size, faces.length);
      const end = Math.min(i + 2 * size, faces.length);
      let left = i, right = middle;
      for (let out = i; out < end; out++) {
        if (out % runSize === 0) yield;
        const takeLeft = right === end || (left < middle && center(faces[left]) <= center(faces[right]));
        buffer[out] = takeLeft ? faces[left++] : faces[right++];
      }
    }
    for (let i = 0; i < faces.length; i++) {
      if (i % runSize === 0) yield;
      faces[i] = buffer[i];
    }
  }
}
function* buildTree(faces: Triangle[]): Steps<Tree> {
  const bounds = yield* boundsOf(faces);
  const node: Tree = { ...bounds, count: faces.length };
  if (faces.length <= 6) return { ...node, faces };
  const extent = bounds.max.subtract(bounds.min);
  const axis = AXES.reduce((a, b) => extent[a] >= extent[b] ? a : b);
  const center = ([a, b, c]: Triangle) => a[axis] + b[axis] + c[axis];
  yield* sortFaces(faces, center);
  const mid = Math.floor(faces.length / 2);
  node.children = [yield* buildTree(faces.slice(0, mid)), yield* buildTree(faces.slice(mid))];
  return node;
};

/** Weld exact duplicated seam vertices and identify closed shells independently of material splits. */
function* shellsOf(faces: Triangle[]): Steps<Shell[]> {
  const vertices = new Map<string, number>();
  const parents: number[] = [];
  const idOf = (v: Vector3) => {
    const key = v.x + "," + v.y + "," + v.z;
    const known = vertices.get(key);
    if (known !== undefined) return known;
    const id = vertices.size;
    vertices.set(key, id);
    parents.push(id);
    return id;
  };
  const root = (v: number) => {
    while (parents[v] !== v) {
      parents[v] = parents[parents[v]];
      v = parents[v];
    }
    return v;
  };
  const edges = new Map<string, number>();
  const records: { face: Triangle; id: number; keys: string[] }[] = [];
  for (const face of faces) {
    if (records.length % 128 === 0) yield;
    const ids = face.map(idOf);
    const keys = ids.map((a, i) => {
      const b = ids[(i + 1) % 3];
      parents[root(b)] = root(a);
      const key = Math.min(a, b) + "/" + Math.max(a, b);
      edges.set(key, (edges.get(key) ?? 0) + 1);
      return key;
    });
    records.push({ face, id: ids[0], keys });
  }
  const groups = new Map<number, Shell>();
  for (let i = 0; i < records.length; i++) {
    if (i % 128 === 0) yield;
    const { face, id, keys } = records[i];
    const index = root(id);
    let group = groups.get(index);
    if (!group) {
      group = { bounds: emptyBounds(), faces: [], closed: true };
      groups.set(index, group);
    }
    group.faces.push(face);
    for (const p of face) include(group.bounds, p);
    if (keys.some(key => edges.get(key) !== 2)) group.closed = false;
  }
  return [...groups.values()];
};

export function* buildCollisionShape(faces: Triangle[], preset: boolean, box = false): Steps<CollisionShape | undefined> {
  if (!faces.length) return undefined;
  let radius = 0;
  for (let i = 0; i < faces.length; i++) {
    if (i % 256 === 0) yield;
    for (const p of faces[i]) radius = Math.max(radius, p.length());
  }
  const tree = yield* buildTree(faces);
  const shells = preset ? [{ faces, bounds: tree, closed: true }] : yield* shellsOf(faces);
  return { radius, tree, shells, box };
};

const worldBounds = (bounds: Bounds, matrix: Matrix): Bounds => {
  const center = Vector3.Center(bounds.min, bounds.max);
  const half = bounds.max.subtract(center);
  const m = matrix.m;
  const extent = new Vector3(
    Math.abs(m[0]) * half.x + Math.abs(m[4]) * half.y + Math.abs(m[8]) * half.z,
    Math.abs(m[1]) * half.x + Math.abs(m[5]) * half.y + Math.abs(m[9]) * half.z,
    Math.abs(m[2]) * half.x + Math.abs(m[6]) * half.y + Math.abs(m[10]) * half.z,
  );
  const point = Vector3.TransformCoordinates(center, matrix);
  return { min: point.subtract(extent), max: point.add(extent) };
};
const boxGap = (a: Bounds, b: Bounds) => Math.hypot(
  ...AXES.map(i => Math.max(0, a.min[i] - b.max[i], b.min[i] - a.max[i])),
);

const normSquared = (v: Vector3): number => Vector3.Dot(v, v);
const clampUnit = (v: number) => Math.max(0, Math.min(1, v));

/** Closest points of two finite segments, including parallel edges. */
const edgeDistance = (p: Vector3, q: Vector3, u: Vector3, v: Vector3) => {
  const a = q.subtract(p), b = v.subtract(u), delta = p.subtract(u);
  const aa = normSquared(a), bb = normSquared(b);
  const ab = Vector3.Dot(a, b), ad = Vector3.Dot(a, delta), bd = Vector3.Dot(b, delta);
  const det = aa * bb - ab * ab;
  let s = det > 0 ? clampUnit((ab * bd - ad * bb) / det) : 0;
  const t = clampUnit((ab * s + bd) / bb);
  s = clampUnit((ab * t - ad) / aa);
  return delta.add(a.scale(s)).subtractInPlace(b.scale(t)).length();
};

/** Tests only the interior projection; edge cases are handled by the edge/edge distances. */
const projectsInside = (p: Vector3, face: Triangle, normal: Vector3): boolean =>
  face.every((v, i) => Vector3.Dot(Vector3.Cross(face[(i + 1) % 3].subtract(v), p.subtract(v)), normal) >= 0);

const faceToPlane = (from: Triangle, to: Triangle): number => {
  const normal = Vector3.Cross(to[1].subtract(to[0]), to[2].subtract(to[0]));
  const length = normal.length();
  const heights = from.map(v => Vector3.Dot(v.subtract(to[0]), normal) / length);
  let closest = Infinity;
  for (let i = 0; i < 3; i++) {
    const p = from[i], j = (i + 1) % 3;
    if (projectsInside(p, to, normal)) closest = Math.min(closest, Math.abs(heights[i]));
    if (heights[i] * heights[j] < 0) {
      const cut = Vector3.Lerp(p, from[j], heights[i] / (heights[i] - heights[j]));
      if (projectsInside(cut, to, normal)) return 0;
    }
  }
  return closest;
};
const triangleDistance = (a: Triangle, b: Triangle): number => {
  let best = Math.min(faceToPlane(a, b), faceToPlane(b, a));
  for (let i = 0; i < 3 && best > 0; i++) {
    for (let j = 0; j < 3; j++) best = Math.min(best, edgeDistance(a[i], a[(i + 1) % 3], b[j], b[(j + 1) % 3]));
  }
  return best;
};

const transformed = (frame: Matrix) => {
  const nodes = new Map<Bounds, Bounds>();
  const vertices = new Map<Vector3, Vector3>();
  const vertex = (p: Vector3) => {
    let world = vertices.get(p);
    if (!world) vertices.set(p, world = Vector3.TransformCoordinates(p, frame));
    return world;
  };
  return {
    bounds(node: Bounds) {
      let world = nodes.get(node);
      if (!world) nodes.set(node, world = worldBounds(node, frame));
      return world;
    },
    triangle: (face: Triangle): Triangle => [vertex(face[0]), vertex(face[1]), vertex(face[2])],
    vertex,
  };
};

const within = (p: Vector3, box: Bounds) => AXES.every(i => p[i] >= box.min[i] && p[i] <= box.max[i]);
const RAYS = [new Vector3(1, 0.3741, 0.6237), new Vector3(0.1753, 1, 0.4369), new Vector3(0.3313, 0.1463, 1)];

/** A ray grazing a welded edge cannot determine parity. Retry another direction. */
function* insideShell(point: Vector3, faces: Triangle[]): Steps<boolean | undefined> {
  for (const dir of RAYS) {
    let count = 0, ambiguous = false;
    for (let i = 0; i < faces.length; i++) {
      if (i % 128 === 0) yield;
      const [a, b, c] = faces[i];
      const e1 = b.subtract(a), e2 = c.subtract(a);
      const cross = Vector3.Cross(dir, e2);
      const det = Vector3.Dot(e1, cross);
      if (det === 0) continue;
      const delta = point.subtract(a);
      const u = Vector3.Dot(delta, cross) / det;
      const vCross = Vector3.Cross(delta, e1);
      const v = Vector3.Dot(dir, vCross) / det;
      const t = Vector3.Dot(e2, vCross) / det;
      if (t <= 0 || Math.min(u, v, 1 - u - v) < -1e-10) continue;
      if (Math.min(u, v, 1 - u - v) <= 1e-10) {
        ambiguous = true;
        break;
      }
      count++;
    }
    if (!ambiguous) return count % 2 === 1;
  }
  return undefined;
};
const axisAligned = (frame: Matrix) => [1, 2, 4, 6, 8, 9].every(i => frame.m[i] === 0);

export const shapeRadius = (shape: CollisionShape): number => shape.radius;

/** Zero is contact. Positive values bound the rigid solids’ clearance from below (metres). */
export function* shapeDistanceSteps(a: CollisionShape, fa: Matrix, b: CollisionShape, fb: Matrix): Steps<number> {
  const wa = transformed(fa), wb = transformed(fb);
  const gap = (x: Tree, y: Tree) => boxGap(wa.bounds(x), wb.bounds(y));
  const outerGap = gap(a.tree, b.tree);
  if (outerGap > 0 || (a.box && b.box && axisAligned(fa) && axisAligned(fb))) return outerGap;
  let uncertain = false;
  function* contained(from: CollisionShape, worldFrom: ReturnType<typeof transformed>, to: CollisionShape, toFrame: Matrix): Steps<boolean> {
    let checks = 0;
    const inverse = Matrix.Invert(toFrame);
    for (const component of from.shells) {
      const p = Vector3.TransformCoordinates(worldFrom.vertex(component.faces[0][0]), inverse);
      let enclosing = 0;
      let ambiguousRay = false;
      for (const shell of to.shells) {
        if (++checks % 128 === 0) yield;
        if (!shell.closed || !within(p, shell.bounds)) continue;
        const result = to.box || (yield* insideShell(p, shell.faces));
        if (result === undefined) ambiguousRay = true;
        if (result) enclosing++;
      }
      // Multiple closed surfaces may represent overlapping parts or a nested void.
      if (enclosing === 1 && !ambiguousRay) return true;
      if (enclosing > 1 || ambiguousRay) uncertain = true;
    }
    return false;
  };
  if ((yield* contained(a, wa, b, fb)) || (yield* contained(b, wb, a, fa))) return 0;
  let best = Infinity;
  function* visit(x: Tree, y: Tree): Steps<void> {
    yield;
    if (gap(x, y) >= best) return;
    if (x.faces && y.faces) {
      for (const left of x.faces) {
        const face = wa.triangle(left);
        for (const right of y.faces) {
          best = Math.min(best, triangleDistance(face, wb.triangle(right)));
          if (best === 0) return;
        }
      }
      return;
    }
    const splitX = x.children && (!y.children || x.count >= y.count);
    const [first, second] = (splitX ? x.children : y.children)!;
    const pairs: [Tree, Tree][] = splitX ? [[first, y], [second, y]] : [[x, first], [x, second]];
    pairs.sort(([x1,y1], [x2,y2]) => gap(x1,y1) - gap(x2,y2));
    for (const [left, right] of pairs) yield* visit(left, right);
  };
  yield* visit(a.tree, b.tree);
  // Only round contact at numerical precision for the actual transformed coordinates.
  const contactTolerance = 32 * Number.EPSILON * Math.max(a.radius, b.radius,
    fa.getTranslation().length(), fb.getTranslation().length(), 1);
  if (best <= contactTolerance) return 0;

  let shellPairs = 0;
  for (const x of a.shells) for (const y of b.shells) {
    if (++shellPairs % 128 === 0) yield;
    if ((!x.closed || !y.closed) && boxGap(wa.bounds(x.bounds), wb.bounds(y.bounds)) === 0) uncertain = true;
  }
  return uncertain ? NaN : best;
};

export const shapeDistance = (a: CollisionShape, fa: Matrix, b: CollisionShape, fb: Matrix): number =>
  finishSteps(shapeDistanceSteps(a, fa, b, fb));
