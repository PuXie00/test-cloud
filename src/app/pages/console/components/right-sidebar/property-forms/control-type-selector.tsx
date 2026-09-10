import { useEffect, useState } from "react";
import { ChevronDown, ImageOff } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/app/components/ui/dialog";
import { cn } from "@/app/components/ui/utils";
import type { ControlType } from "@/app/project/configuration-types";
import oneMoveGif from "@/assets/prompt/one-move.gif";
import oneRotateGif from "@/assets/prompt/one-rotate.gif";
import oneUpdownGif from "@/assets/prompt/one-updowm.gif";
import orbitGif from "@/assets/prompt/orbit.gif";
import twoSwingGif from "@/assets/prompt/two-swing.gif";
import fourSwingGif from "@/assets/prompt/four-swing.gif";
import multiSwingGif from "@/assets/prompt/multi-swing.gif";
import { CONTROL_TYPE_DEFINITIONS } from "../config-wizard/config-descriptors";

type ControlTypeSelectorProps = {
  value?: ControlType;
  onChange?: (value: ControlType) => void;
  disabled?: boolean;
};

const CONTROL_TYPE_PROMPT_GIF: Partial<Record<ControlType, string>> = {
  singlePointMove: oneMoveGif,
  continuousRotation: oneRotateGif,
  multiLevelHoist: oneUpdownGif,
  railCar: orbitGif,
  twoPointSwing: twoSwingGif,
  fourPointSwing: fourSwingGif,
  dualTiltFourPointSwing: fourSwingGif,
  multiPointSwing: multiSwingGif,
};

const btnPrimary =
  "inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-label-caps text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40";
const btnSecondary =
  "inline-flex h-9 items-center justify-center rounded-md border border-border bg-transparent px-4 text-label-caps text-foreground hover:bg-accent";

export const ControlTypeSelector = ({ value, onChange, disabled }: ControlTypeSelectorProps) => {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<ControlType | undefined>(value);

  useEffect(() => {
    if (open) setDraft(value);
  }, [open, value]);

  const currentLabel = value
    ? CONTROL_TYPE_DEFINITIONS.find((item) => item.id === value)?.label
    : undefined;

  const handleOpenChange = (next: boolean) => {
    if (disabled && next) return;
    setOpen(next);
  };

  const handleConfirm = () => {
    if (!draft) return;
    if (draft !== value) onChange?.(draft);
    setOpen(false);
  };

  return (
    <>
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="选择控制类型"
        onClick={() => handleOpenChange(true)}
        className={cn(
          "flex h-9 w-full min-w-0 items-center gap-2 rounded-md bg-input-background px-3 text-left",
          "border border-border/60 text-body-sm text-foreground",
          "hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          "disabled:cursor-not-allowed disabled:opacity-50",
        )}
      >
        <span className={cn("min-w-0 flex-1 truncate", !currentLabel && "text-muted-foreground")}>
          {currentLabel ?? (value === undefined ? "多种类型" : "选择控制类型")}
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      </button>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className=" gap-0 overflow-hidden border-0 bg-card p-0 shadow-[0_4px_24px_rgba(0,0,0,0.4)] sm:max-w-180">
          <DialogHeader className="bg-muted px-4 py-3 text-left">
            <DialogTitle className="text-heading-md text-foreground">选择控制类型</DialogTitle>
            <DialogDescription className="text-body-sm text-muted-foreground">
              预览示意动画后选择，点击确定生效
            </DialogDescription>
          </DialogHeader>

          <div className="custom-scrollbar bg-background p-4">
            <div
              className="grid grid-cols-5 items-stretch gap-3"
              role="listbox"
              aria-label="控制类型列表"
            >
              {CONTROL_TYPE_DEFINITIONS.map((definition) => {
                const gifSrc = CONTROL_TYPE_PROMPT_GIF[definition.id];
                const selected = draft === definition.id;
                const isCurrent = value === definition.id;
                return (
                  <button
                    key={definition.id}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    aria-label={definition.label}
                    onClick={() => setDraft(definition.id)}
                    className={cn(
                      "flex h-full flex-col overflow-hidden rounded-md border bg-muted text-left",
                      selected ? "border-primary" : "border-transparent",
                    )}
                  >
                    <div className="h-32 w-full relative">
                      <div className="flex items-center justify-center p-1">
                        {gifSrc ? (
                          <img
                            src={gifSrc}
                            alt=""
                            className="h-full w-full object-contain"
                            draggable={false}
                          />
                        ) : (
                          <div className="flex flex-col items-center justify-center gap-1 text-muted-foreground">
                            <ImageOff className="h-5 w-5" aria-hidden />
                            <span className="text-mono-sm">暂无示意</span>
                          </div>
                        )}
                      </div>
                      {isCurrent ? (
                        <span className="absolute left-2 top-2 z-10 rounded-full bg-show px-2 py-0.5 text-[10px] font-medium text-background">
                          当前
                        </span>
                      ) : null}
                    </div>
                    <div className="flex h-17 flex-col justify-center gap-0.5 px-2.5 py-2">
                      <p className="line-clamp-2 min-h-9 text-body-sm font-medium leading-4.5 text-foreground">
                        {definition.label}
                      </p>
                      <p className="font-mono text-mono-sm tabular-nums text-muted-foreground">
                        至少 {definition.minimumDriveAxes} 轴
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <DialogFooter className="bg-muted px-4 py-3 sm:justify-end">
            <button type="button" className={btnSecondary} onClick={() => setOpen(false)}>
              取消
            </button>
            <button
              type="button"
              className={btnPrimary}
              disabled={!draft}
              onClick={handleConfirm}
            >
              确定
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};
