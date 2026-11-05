import { Plus, X } from "lucide-react";
import { toast } from "sonner";
import { UnitAwareNumericInput } from "@/app/components/ics/unit-aware-numeric-input";
import { cn } from "@/app/components/ui/utils";
import {
  ADJUST_DISTANCE_LIMIT,
  isAdjustDistanceInStroke,
  MULTI_LEVEL_MAX_SECTIONS,
  nextAdjustDistance,
  setAdjustDistance,
  type MultiLevelConfig,
} from "@/app/project/multi-level-hoist";

type MultiLevelSectionProps = {
  config: MultiLevelConfig;
  /** 高度行程（mm）：分段点要在两端之间 */
  stroke: { min: number; max: number };
  onChange: (config: MultiLevelConfig) => void;
};

const iconButton =
  "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-40 [@media(pointer:coarse)]:h-10 [@media(pointer:coarse)]:w-10";

/**
 * 多级升降：中间分段点（严格递增、不含行程端点，改完自动排序）和过分段点速度保留比例。
 * 分段点数量就是列表长度（nSections）。
 */
export const MultiLevelSection = ({ config, stroke, onChange }: MultiLevelSectionProps) => {
  const points = config.adjustDistances;
  const outside = points.filter((point) => !isAdjustDistanceInStroke(point, stroke)).length;
  const full = points.length >= MULTI_LEVEL_MAX_SECTIONS;

  const commitPoint = (index: number, value: number) => {
    const edit = setAdjustDistance(points, index, value, stroke);
    if (!edit.ok) {
      toast.warning(edit.reason);
      return;
    }
    onChange({ ...config, adjustDistances: edit.adjustDistances });
  };

  const handleAdd = () => {
    const value = nextAdjustDistance(points, stroke);
    if (value === null) {
      toast.warning("行程内没有空位再加分段点");
      return;
    }
    commitPoint(points.length, value);
  };

  const handleRemove = (index: number) => {
    onChange({ ...config, adjustDistances: points.filter((_, at) => at !== index) });
  };

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-2">
          <span className="text-body-sm text-muted-foreground">
            中间分段点（{points.length}/{MULTI_LEVEL_MAX_SECTIONS}）
          </span>
          <button
            type="button"
            className={iconButton}
            aria-label="添加分段点"
            disabled={full}
            onClick={handleAdd}
          >
            <Plus className="h-4 w-4" aria-hidden />
          </button>
        </div>
        {points.length === 0 ? (
          <p className="text-body-sm text-muted-foreground">没有中间分段点，整段行程不分段</p>
        ) : (
          <ol className="space-y-1">
            {points.map((point, index) => {
              const inStroke = isAdjustDistanceInStroke(point, stroke);
              return (
                <li key={`${index}:${point}`} className="flex items-center gap-2">
                  <span className="w-6 shrink-0 font-mono text-mono-sm text-muted-foreground">
                    {index + 1}
                  </span>
                  <UnitAwareNumericInput
                    aria-label={`分段点 ${index + 1}`}
                    value={point}
                    onCommit={(next) => commitPoint(index, next)}
                    min={-ADJUST_DISTANCE_LIMIT}
                    max={ADJUST_DISTANCE_LIMIT}
                    step={10}
                    precision={1}
                    unit="mm"
                    className={cn("min-w-0 flex-1", !inStroke && "ring-1 ring-destructive")}
                  />
                  <button
                    type="button"
                    className={iconButton}
                    aria-label={`删除分段点 ${index + 1}`}
                    onClick={() => handleRemove(index)}
                  >
                    <X className="h-4 w-4" aria-hidden />
                  </button>
                </li>
              );
            })}
          </ol>
        )}
        {outside > 0 ? (
          <p role="status" className="text-body-sm text-destructive">
            {outside} 个分段点不在行程范围内，不会下发
          </p>
        ) : null}
      </div>
      <div className="space-y-1">
        <span className="text-body-sm text-muted-foreground">过分段点速度保留比例</span>
        <UnitAwareNumericInput
          aria-label="过分段点速度保留比例"
          value={config.decelerationRatio}
          onCommit={(decelerationRatio) => onChange({ ...config, decelerationRatio })}
          min={0}
          max={100}
          step={1}
          precision={0}
          unit="%"
        />
      </div>
    </div>
  );
};
