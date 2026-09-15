import { Circle, Power, Spline, Waves, Wind } from "lucide-react";
import { SectionHeader } from "@/app/components/ics/section-header";
import type { StaticPresetParams } from "../action-builder-context-types";
import type { ObjectSelectionMode } from "./object-selection-mode";

const STATIC_PRESETS = [
  { id: "static-flat", label: "平面", icon: Circle },
  { id: "static-slope", label: "斜面", icon: Spline },
  { id: "static-arc", label: "弧形", icon: Spline },
  { id: "static-wave", label: "静态波浪", icon: Waves },
] as const;

const DYNAMIC_PRESETS = [
  { id: "dynamic-level", label: "水平升降", icon: Wind },
  { id: "dynamic-wave", label: "行进波浪", icon: Waves },
] as const;

const DEFAULT_STATIC_PRESET_PARAMS: StaticPresetParams = { amplitude: 100, phase: 0 };

type ObjectSelectionPanelProps = {
  mode: ObjectSelectionMode;
  selectedObjectIds: number[];
  sequenceMissing?: boolean;
  onCreatePose: (objectIds: number[]) => void;
  onCreateSetEnabled: (objectIds: number[], enabled: boolean) => void;
  onCreateSequence: (objectIds: number[]) => void;
  onApplyStaticPreset: (presetId: string, objectIds: number[], params: StaticPresetParams) => void;
  onApplyDynamicPreset: (presetId: string, objectIds: number[]) => void;
};

const actionButtonClass =
  "flex min-h-10 items-center justify-center rounded-md border border-border bg-transparent px-2 text-body-sm text-foreground hover:bg-accent";

export const ObjectSelectionPanel = ({
  mode,
  selectedObjectIds,
  sequenceMissing = false,
  onCreatePose,
  onCreateSetEnabled,
  onCreateSequence,
  onApplyStaticPreset,
  onApplyDynamicPreset,
}: ObjectSelectionPanelProps) => {
  const isMulti = selectedObjectIds.length > 1;

  return (
    <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto p-4">
      {mode === "sequence" && sequenceMissing && (
        <p className="mb-3 rounded-md bg-warning/10 px-3 py-2 text-body-sm text-warning">
          请先选择或新建动作序列
        </p>
      )}

      {mode === "sequence" && (
        <>
          <div className="mb-4 flex justify-center">
            <button
                type="button"
                onClick={() => onCreatePose(selectedObjectIds)}
                className="flex min-h-10 w-full items-center justify-center rounded-md bg-primary px-2 text-body-sm font-semibold text-primary-foreground hover:bg-primary/90"
              >
                添加位姿
              </button>
          </div>
          <SectionHeader title="新建指令" />
          <div className="mb-4 grid grid-cols-2 gap-2">
            
            <button
              type="button"
              onClick={() => onCreateSetEnabled(selectedObjectIds, true)}
              className={`${actionButtonClass} gap-1.5`}
            >
              <Power className="h-4 w-4 text-show" aria-hidden />
              使能
            </button>
            <button
              type="button"
              onClick={() => onCreateSetEnabled(selectedObjectIds, false)}
              className={`${actionButtonClass} gap-1.5`}
            >
              <Power className="h-4 w-4 text-muted-foreground" aria-hidden />
              断使能
            </button>
          </div>

          {isMulti && (
            <>
              <SectionHeader title="静态预设" />
              <div className="mb-4 grid grid-cols-2 gap-2">
                {STATIC_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    aria-label={`静态预设 ${preset.label}`}
                    onClick={() =>
                      onApplyStaticPreset(preset.id, selectedObjectIds, DEFAULT_STATIC_PRESET_PARAMS)
                    }
                    className="flex min-h-10 flex-col items-center justify-center gap-1 rounded-md border border-border bg-background px-2 py-2 text-body-sm text-foreground hover:bg-accent"
                  >
                    <preset.icon className="h-4 w-4 text-primary" aria-hidden />
                    {preset.label}
                  </button>
                ))}
              </div>
              <SectionHeader title="动态预设" />
              <div className="mb-4 grid grid-cols-2 gap-2">
                {DYNAMIC_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    aria-label={`动态预设 ${preset.label}`}
                    onClick={() => onApplyDynamicPreset(preset.id, selectedObjectIds)}
                    className="flex min-h-10 flex-col items-center justify-center gap-1 rounded-md border border-border bg-background px-2 py-2 text-body-sm text-foreground hover:bg-accent"
                  >
                    <preset.icon className="h-4 w-4 text-secondary" aria-hidden />
                    {preset.label}
                  </button>
                ))}
              </div>
            </>
          )}
        </>
      )}

      <SectionHeader title="新建" />
      <div className="grid grid-cols-1 gap-2">
        <button
          type="button"
          onClick={() => onCreateSequence(selectedObjectIds)}
          className="rounded-md border border-border bg-transparent py-2 text-body-sm text-foreground hover:bg-accent"
        >
          新建动作序列
        </button>
      </div>
    </div>
  );
};

/** @deprecated Use ObjectSelectionPanel */
export const SelectionPanel = ObjectSelectionPanel;
