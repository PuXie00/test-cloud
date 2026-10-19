import { Save } from "lucide-react";

type QuickActionsProps = {
  canSave: boolean;
  onSave: () => void;
  /** 按钮文字，默认「保存当前位姿」 */
  label?: string;
  /** 不能保存的原因 */
  hint?: string | null;
};

export const QuickActions = ({
  canSave,
  onSave,
  label = "保存当前位姿",
  hint = null,
}: QuickActionsProps) => (
  <div className="space-y-2 px-3 py-3">
    <div className="overflow-hidden rounded-md">
      <div className="flex h-9 items-center bg-muted px-3">快捷操作</div>
      <div className="bg-background p-3">
        <div className="flex gap-1">
          <button
            type="button"
            disabled={!canSave}
            onClick={onSave}
            className="inline-flex h-10 flex-1 items-center justify-center gap-1 rounded-sm bg-foreground text-background hover:bg-foreground/80 disabled:pointer-events-none disabled:opacity-40"
          >
            <Save className="h-4 w-4" /> {label}
          </button>
        </div>
        {hint ? <p className="mt-2 text-body-sm text-warning">{hint}</p> : null}
      </div>
    </div>
  </div>
);
