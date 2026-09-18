import { Circle, Spline, Waves, Wind, Power, type LucideIcon } from "lucide-react";
import { SectionHeader } from "@/app/components/ics/section-header";
import { listPresetDefinitions } from "@/app/project/action-sequence/preset-registry";
import type { ObjectSelectionMode } from "./object-selection-mode";

const PRESET_ICONS: Record<string, LucideIcon> = {
  "static-flat": Circle,
  "static-slope": Spline,
  "static-arc": Spline,
  "static-wave": Waves,
  "dynamic-level": Wind,
  "dynamic-wave": Waves,
};

type ObjectSelectionPanelProps = {
  mode: ObjectSelectionMode;
  selectedObjectIds: number[];
  sequenceMissing?: boolean;
  onCreatePose: (objectIds: number[]) => void;
  onCreateSetEnabled: (objectIds: number[], enabled: boolean) => void;
  onCreateSequence: (objectIds: number[]) => void;
  onApplyStaticPreset: (presetId: string, objectIds: number[]) => void;
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
  const staticPresets = listPresetDefinitions("static");
  const dynamicPresets = listPresetDefinitions("dynamic");

  return (
    <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto p-4">
      {mode === "sequence" && sequenceMissing && (
        <p className="mb-3 rounded-md bg-warning-surface px-3 py-2 text-body-sm text-warning">
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
              <p className="mb-2 text-label-caps text-muted-foreground">静态预设</p>
              <div className="mb-4 rounded-md bg-muted p-3">
                <div className="grid grid-cols-2 gap-2">
                  {staticPresets.map((preset) => {
                    const Icon = PRESET_ICONS[preset.id] ?? Circle;
                    return (
                      <button
                        key={preset.id}
                        type="button"
                        aria-label={`静态预设 ${preset.label}`}
                        onClick={() => onApplyStaticPreset(preset.id, selectedObjectIds)}
                        className="flex min-h-10 flex-col items-center justify-center gap-1 rounded-md bg-input-background px-2 py-2 text-center hover:bg-accent"
                      >
                        <Icon className="h-4 w-4 text-primary" aria-hidden />
                        <span className="text-body-sm text-foreground">{preset.label}</span>
                        <span className="text-body-sm text-muted-foreground">
                          {preset.description}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
              <p className="mb-2 text-label-caps text-muted-foreground">动态预设</p>
              <div className="mb-4 rounded-md bg-muted p-3">
                <div className="grid grid-cols-2 gap-2">
                  {dynamicPresets.map((preset) => {
                    const Icon = PRESET_ICONS[preset.id] ?? Waves;
                    return (
                      <button
                        key={preset.id}
                        type="button"
                        aria-label={`动态预设 ${preset.label}`}
                        onClick={() => onApplyDynamicPreset(preset.id, selectedObjectIds)}
                        className="flex min-h-10 flex-col items-center justify-center gap-1 rounded-md bg-input-background px-2 py-2 text-center hover:bg-accent"
                      >
                        <Icon className="h-4 w-4 text-secondary" aria-hidden />
                        <span className="text-body-sm text-foreground">{preset.label}</span>
                        <span className="text-body-sm text-muted-foreground">
                          {preset.description}
                        </span>
                       
                      </button>
                    );
                  })}
                </div>
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
