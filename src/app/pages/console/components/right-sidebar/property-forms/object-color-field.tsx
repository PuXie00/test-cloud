import { cn } from "@/app/components/ui/utils";
import { Switch } from "@/app/components/ui/switch";
import { OBJECT_COLORS } from "../config-wizard/config-wizard-constants";

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

/** 取色器只认 #rrggbb；不合法时退回默认色 */
export const normalizeObjectColor = (color: string | null | undefined): string =>
  color && HEX_COLOR.test(color) ? color.toLowerCase() : OBJECT_COLORS[0];

const sameColor = (a: string | null, b: string): boolean =>
  a != null && a.toLowerCase() === b.toLowerCase();

export type ObjectColorFieldProps = {
  /** 当前颜色；多选不一致时传 null */
  value: string | null;
  onChange: (color: string) => void;
  /**
   * 有导入模型时才显示「模型染色」开关。
   * 传 null 表示多选里染色状态不一致（开关显示为关）。
   */
  tintModel?: boolean | null;
  onTintModelChange?: (tintModel: boolean) => void;
};

/**
 * 物体颜色：常用色块 + 自定义取色。
 * 取色器拖动时连续改色，外层 ProjectEditBoundary 按聚焦会话合成一步撤销（失焦时提交）。
 */
export const ObjectColorField = ({
  value,
  onChange,
  tintModel,
  onTintModelChange,
}: ObjectColorFieldProps) => {
  const showTint = tintModel !== undefined && onTintModelChange !== undefined;
  const isCustom = value != null && !OBJECT_COLORS.some((color) => sameColor(value, color));

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {OBJECT_COLORS.map((color) => (
          <button
            key={color}
            type="button"
            aria-label={`颜色 ${color}`}
            aria-pressed={sameColor(value, color)}
            onClick={() => onChange(color)}
            className={cn(
              "h-8 w-8 rounded-sm border-2 transition-transform hover:scale-105",
              sameColor(value, color) ? "border-primary" : "border-transparent",
            )}
            style={{ backgroundColor: color }}
          />
        ))}
        <label
          title="自定义颜色"
          className={cn(
            "relative h-8 w-8 cursor-pointer overflow-hidden rounded-sm border-2 transition-transform hover:scale-105",
            isCustom ? "border-primary" : "border-dashed border-muted-foreground/60",
          )}
          style={isCustom ? { backgroundColor: value } : undefined}
        >
          {!isCustom ? (
            <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-body-sm text-muted-foreground">
              +
            </span>
          ) : null}
          <input
            type="color"
            aria-label="自定义颜色"
            value={normalizeObjectColor(value)}
            onChange={(event) => onChange(event.target.value)}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          />
        </label>
      </div>
      {showTint ? (
        <label
          className="flex items-start gap-2"
          title="关闭时用模型自己的颜色和贴图；打开后没贴图的部分染成上面的颜色，带贴图的部分不变"
        >
          <Switch
            checked={tintModel === true}
            onCheckedChange={(checked) => onTintModelChange(checked)}
            aria-label="模型染色"
            className="mt-0.5"
          />
          <span className="space-y-0.5">
            <span className="block text-body-sm text-foreground">模型染色</span>
            <span className="block text-body-sm text-muted-foreground">带贴图的部分不变</span>
          </span>
        </label>
      ) : null}
    </div>
  );
};
