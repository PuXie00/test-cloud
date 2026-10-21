/**
 * python/调速范围计算 的数值工具：math.nextafter、math.fsum 和向外舍入的双精度区间 _SpeedInterval。
 */

const float = new Float64Array(1);
const bits = new BigInt64Array(float.buffer);

/** math.nextafter(x, +inf) */
export const nextUp = (value: number): number => {
  if (Number.isNaN(value) || value === Number.POSITIVE_INFINITY) return value;
  if (value === 0) return Number.MIN_VALUE;
  float[0] = value;
  bits[0] = value > 0 ? bits[0]! + 1n : bits[0]! - 1n;
  return float[0];
};

/** math.nextafter(x, -inf) */
export const nextDown = (value: number): number => -nextUp(-value);

/** math.fsum：Shewchuk 部分和，结果按 CPython 的方式做最后一次舍入 */
export const fsum = (values: readonly number[]): number => {
  const partials: number[] = [];
  for (const value of values) {
    let x = value;
    let count = 0;
    for (let index = 0; index < partials.length; index += 1) {
      let y = partials[index]!;
      if (Math.abs(x) < Math.abs(y)) [x, y] = [y, x];
      const hi = x + y;
      const lo = y - (hi - x);
      if (lo !== 0) partials[count++] = lo;
      x = hi;
    }
    partials.length = count;
    partials.push(x);
  }
  let n = partials.length;
  if (n === 0) return 0;
  n -= 1;
  let hi = partials[n]!;
  let lo = 0;
  while (n > 0) {
    const x = hi;
    const y = partials[--n]!;
    hi = x + y;
    lo = y - (hi - x);
    if (lo !== 0) break;
  }
  if (n > 0 && ((lo < 0 && partials[n - 1]! < 0) || (lo > 0 && partials[n - 1]! > 0))) {
    const y = lo * 2;
    const x = hi + y;
    if (y === x - hi) hi = x;
  }
  return hi;
};

export const comb = (n: number, k: number): number => {
  let result = 1;
  for (let index = 1; index <= k; index += 1) result = (result * (n - k + index)) / index;
  return Math.round(result);
};

type Operand = SpeedInterval | number;

/** 内部双精度区间：每次运算向外扩一格，避免把计算范围向内舍入 */
export class SpeedInterval {
  lo: number;
  hi: number;

  constructor(lo: number, hi?: number) {
    this.lo = lo;
    this.hi = hi === undefined ? lo : hi;
  }

  static outward(lo: number, hi: number): SpeedInterval {
    return new SpeedInterval(nextDown(lo), nextUp(hi));
  }

  static of(value: Operand): SpeedInterval {
    return value instanceof SpeedInterval ? value : new SpeedInterval(value);
  }

  isZero(): boolean {
    return this.lo === 0 && this.hi === 0;
  }

  add(other: Operand): SpeedInterval {
    const right = SpeedInterval.of(other);
    if (this.isZero()) return right;
    if (right.isZero()) return this;
    return SpeedInterval.outward(this.lo + right.lo, this.hi + right.hi);
  }

  neg(): SpeedInterval {
    return new SpeedInterval(-this.hi, -this.lo);
  }

  sub(other: Operand): SpeedInterval {
    return this.add(other instanceof SpeedInterval ? other.neg() : -other);
  }

  mul(other: Operand): SpeedInterval {
    const right = SpeedInterval.of(other);
    if (this.isZero() || right.isZero()) return new SpeedInterval(0);
    const values = [
      this.lo * right.lo,
      this.lo * right.hi,
      this.hi * right.lo,
      this.hi * right.hi,
    ];
    return SpeedInterval.outward(Math.min(...values), Math.max(...values));
  }

  div(other: Operand): SpeedInterval {
    const right = SpeedInterval.of(other);
    if (right.lo <= 0 && 0 <= right.hi) throw new Error("速度上界的区间除数包含0");
    if (this.isZero()) return new SpeedInterval(0);
    // 直接相除，避免先取倒数时小尺寸溢出
    const values = [
      this.lo / right.lo,
      this.lo / right.hi,
      this.hi / right.lo,
      this.hi / right.hi,
    ];
    return SpeedInterval.outward(Math.min(...values), Math.max(...values));
  }

  square(): SpeedInterval {
    const lower = this.lo <= 0 && 0 <= this.hi ? 0 : Math.min(this.lo * this.lo, this.hi * this.hi);
    const upper = Math.max(this.lo * this.lo, this.hi * this.hi);
    const result = SpeedInterval.outward(lower, upper);
    result.lo = Math.max(0, result.lo);
    return result;
  }

  sqrt(): SpeedInterval {
    const result = SpeedInterval.outward(Math.sqrt(Math.max(0, this.lo)), Math.sqrt(Math.max(0, this.hi)));
    result.lo = Math.max(0, result.lo);
    return result;
  }

  maxAbs(): number {
    return Math.max(Math.abs(this.lo), Math.abs(this.hi));
  }

  /** 扫描端点和区间内的三角函数极值；大角度直接用 [-1,1] 保守包围 */
  trig(cosine = false): SpeedInterval {
    if (this.hi - this.lo >= 2 * Math.PI || Math.max(Math.abs(this.lo), Math.abs(this.hi)) > 1e6) {
      return new SpeedInterval(-1, 1);
    }
    const fn = cosine ? Math.cos : Math.sin;
    const values = [fn(this.lo), fn(this.hi)];
    const first = Math.floor(this.lo / (Math.PI / 2)) - 1;
    const last = Math.ceil(this.hi / (Math.PI / 2)) + 1;
    // 对三角函数端点和 pi 常量外扩 8 ulp
    let piRange = new SpeedInterval(Math.PI);
    for (let index = 0; index < 8; index += 1) piRange = SpeedInterval.outward(piRange.lo, piRange.hi);
    for (let k = first; k <= last; k += 1) {
      const critical = piRange.mul(k / 2);
      if (critical.lo <= this.hi && critical.hi >= this.lo) {
        const quarter = ((k % 4) + 4) % 4;
        values.push(cosine ? [1, 0, -1, 0][quarter]! : [0, 1, 0, -1][quarter]!);
      }
    }
    let lo = Math.min(...values);
    let hi = Math.max(...values);
    for (let index = 0; index < 8; index += 1) {
      lo = nextDown(lo);
      hi = nextUp(hi);
    }
    return new SpeedInterval(Math.max(-1, lo), Math.min(1, hi));
  }
}

export const interval = (lo: number, hi?: number): SpeedInterval => new SpeedInterval(lo, hi);

/** heapq 等价的二叉堆：比较函数返回负数表示 left 先出 */
export class BinaryHeap<T> {
  private readonly items: T[] = [];

  constructor(private readonly compare: (left: T, right: T) => number) {}

  get size(): number {
    return this.items.length;
  }

  peek(): T | undefined {
    return this.items[0];
  }

  push(item: T): void {
    const items = this.items;
    items.push(item);
    let index = items.length - 1;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (this.compare(items[index]!, items[parent]!) >= 0) break;
      [items[index], items[parent]] = [items[parent]!, items[index]!];
      index = parent;
    }
  }

  pop(): T | undefined {
    const items = this.items;
    const top = items[0];
    const last = items.pop();
    if (items.length > 0 && last !== undefined) {
      items[0] = last;
      let index = 0;
      for (;;) {
        const left = index * 2 + 1;
        const right = left + 1;
        let smallest = index;
        if (left < items.length && this.compare(items[left]!, items[smallest]!) < 0) smallest = left;
        if (right < items.length && this.compare(items[right]!, items[smallest]!) < 0) smallest = right;
        if (smallest === index) break;
        [items[index], items[smallest]] = [items[smallest]!, items[index]!];
        index = smallest;
      }
    }
    return top;
  }
}
