import { ImageOff } from "lucide-react";
import { cn } from "@/app/components/ui/utils";
import { CONTROL_TYPE_PROMPT_GIF } from "../property-forms/control-type-prompts";
import {
  formatAxisRequirement,
  WIZARD_MOTION_GROUPS,
  type WizardMotionOption,
} from "./wizard-motion-options";

type WizardMotionPickerProps = {
  onPick: (option: WizardMotionOption) => void;
};

/** 先选运动方式：它决定吊点数量，点一下就在 3D 里建出物体 */
export const WizardMotionPicker = ({ onPick }: WizardMotionPickerProps) => (
  <div className="grid grid-cols-4 gap-x-3 gap-y-3 rounded-md bg-muted p-3">
    {WIZARD_MOTION_GROUPS.map((group) => (
      <section key={group.label} className={group.span === 4 ? "col-span-4" : "col-span-2"}>
        <h3 className="mb-1.5 text-label-caps text-muted-foreground">{group.label}</h3>
        <div
          className={cn(
            "grid gap-2",
            group.span === 4 && !group.compact ? "grid-cols-4" : "grid-cols-2",
          )}
        >
          {group.options.map((option) => {
            const gif = CONTROL_TYPE_PROMPT_GIF[option.controlType];
            return (
              <button
                key={option.controlType}
                type="button"
                onClick={() => onPick(option)}
                className="flex min-w-0 flex-col gap-1 rounded-md bg-input-background p-2 text-left hover:bg-accent"
              >
                {group.compact ? null : (
                  <span className="flex h-16 items-center justify-center" aria-hidden>
                    {gif ? (
                      <img
                        src={gif}
                        alt=""
                        className="h-full w-full object-contain"
                        draggable={false}
                      />
                    ) : (
                      <ImageOff className="h-5 w-5 text-muted-foreground" />
                    )}
                  </span>
                )}
                <span className="text-body-sm font-medium text-foreground">{option.title}</span>
                <span className="text-body-sm text-muted-foreground">{option.detail}</span>
                <span className="font-mono text-mono-sm text-muted-foreground">
                  {formatAxisRequirement(option.controlType)}
                </span>
              </button>
            );
          })}
        </div>
      </section>
    ))}
  </div>
);
