import { Fragment } from "react";
import { cn } from "@/app/components/ui/utils";
import {
  axisIconStyle,
  SCENE_AXES,
  SCENE_DISTRIBUTE_MIN_COUNT,
  useAxisScreenDirections,
  useSceneBuildActions,
} from "@/app/pages/console/3d/use-scene-build-actions";

const btnClass =
  "inline-flex h-8 min-w-0 flex-1 items-center justify-center gap-0.5 rounded-md border border-border bg-transparent px-0.5 text-body-sm text-foreground hover:bg-accent disabled:pointer-events-none disabled:opacity-40 [@media(pointer:coarse)]:h-11";

const iconSizeClass = "h-4 w-4 shrink-0";

type SceneArrangeSectionProps = {
  selectedCount: number;
};

/** 多选时的对齐和均布：图标画当前视图里的移动方向，文字写明含义，不靠悬停提示 */
export const SceneArrangeSection = ({ selectedCount }: SceneArrangeSectionProps) => {
  const { alignSelection, distributeSelection } = useSceneBuildActions();
  const canAlign = selectedCount >= 2;
  const canDistribute = selectedCount >= SCENE_DISTRIBUTE_MIN_COUNT;
  const directions = useAxisScreenDirections();

  return (
    <section className="space-y-2 rounded-md bg-muted p-3" aria-label="对齐与均布">
      <div className="grid grid-cols-[auto_minmax(0,1fr)_3.25rem] items-center gap-x-2 gap-y-1.5">
        <span />
        <span className="text-label-caps text-muted-foreground">对齐</span>
        <span />
        {SCENE_AXES.map(({ axis, letter, name, colorClass, followsView, distributeIcon: DistributeIcon, edges }) => {
          const iconStyle = axisIconStyle(axis, followsView, directions);
          return (
          <Fragment key={axis}>
            <span className="whitespace-nowrap text-body-sm text-muted-foreground">
              <span className={cn("font-mono", colorClass)}>{letter}</span> {name}
            </span>
            <div className="flex min-w-0 gap-1">
              {edges.map(({ edge, label, icon: Icon }) => (
                <button
                  key={edge}
                  type="button"
                  disabled={!canAlign}
                  aria-label={`${letter} ${name}${label}对齐`}
                  className={btnClass}
                  onClick={() => alignSelection(axis, edge)}
                >
                  <Icon className={cn(iconSizeClass, colorClass)} style={iconStyle} aria-hidden />
                  {label}
                </button>
              ))}
            </div>
            <button
              type="button"
              disabled={!canDistribute}
              aria-label={`沿 ${letter} ${name}均布`}
              className={btnClass}
              onClick={() => distributeSelection(axis)}
            >
              <DistributeIcon className={cn(iconSizeClass, colorClass)} style={iconStyle} aria-hidden />
              均布
            </button>
          </Fragment>
          );
        })}
      </div>
      <p className="text-body-sm text-muted-foreground">
        {canDistribute
          ? "均布时最外侧两个物体不动，中间的等间隙排开。"
          : `至少选 ${SCENE_DISTRIBUTE_MIN_COUNT} 个物体才能均布。`}
      </p>
    </section>
  );
};
