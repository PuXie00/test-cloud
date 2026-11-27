import { useCallback, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { cn } from "@/app/components/ui/utils";

export type MonitorSort = { key: string; direction: "ascending" | "descending" } | null;
type SortValue = string | number | null | undefined;

const collator = new Intl.Collator("zh-CN", { numeric: true, sensitivity: "base" });

export function useMonitorSort() {
  const [sort, setSort] = useState<MonitorSort>(null);
  const onSort = useCallback((key: string) => {
    setSort(current => {
      if (current?.key !== key) return { key, direction: "ascending" };
      return current.direction === "ascending" ? { key, direction: "descending" } : null;
    });
  }, []);
  return [sort, onSort] as const;
}

export function sortMonitorRows<T>(
  rows: T[],
  sort: MonitorSort,
  valueFor: (row: T, key: string) => SortValue,
  groupFor?: (row: T) => string,
): T[] {
  if (!sort || rows.length < 2) return rows;
  const sign = sort.direction === "ascending" ? 1 : -1;
  // 先取一次排序值，避免每次比较都重新解析状态或枚举。
  const keyed = rows.map(row => {
    const raw = valueFor(row, sort.key);
    const value = typeof raw === "number" && !Number.isFinite(raw) ? null : raw;
    return { row, value, group: groupFor?.(row) ?? "" };
  });
  keyed.sort((a, b) => {
    if (a.value == null) return b.value == null ? 0 : 1;
    if (b.value == null) return -1;
    if (a.group !== b.group) return collator.compare(a.group, b.group);
    if (typeof a.value === "number" && typeof b.value === "number") return sign * (a.value - b.value);
    return sign * collator.compare(String(a.value), String(b.value));
  });
  return keyed.map(item => item.row);
}

type SortableMonitorHeaderProps = {
  columnKey: string;
  label: string;
  sort: MonitorSort;
  onSort: (key: string) => void;
  hint?: string;
};

export function SortableMonitorHeader({ columnKey, label, sort, onSort, hint }: SortableMonitorHeaderProps) {
  const direction = sort?.key === columnKey ? sort.direction : undefined;
  const Icon = direction === "ascending" ? ArrowUp : direction === "descending" ? ArrowDown : ArrowUpDown;
  const next = direction === "descending" ? "恢复原顺序" : direction === "ascending" ? "降序排列" : "升序排列";
  return (
    <th scope="col" aria-sort={direction} className="text-left text-label-caps">
      <button
        type="button"
        onClick={() => onSort(columnKey)}
        title={hint ? `${next}。\n${hint}` : next}
        className={cn(
          "group inline-flex w-full items-center gap-1 whitespace-nowrap rounded-sm px-3 py-2 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
          direction ? "text-primary" : "text-muted-foreground",
        )}
      >
        {label}
        <Icon aria-hidden="true" className={cn("size-3 shrink-0", !direction && "opacity-50 group-hover:opacity-100")} />
      </button>
    </th>
  );
}
