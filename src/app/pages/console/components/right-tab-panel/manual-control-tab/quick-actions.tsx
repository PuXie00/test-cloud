import { Save, Sliders } from "lucide-react";

export const QuickActions = () => {return (
  <div className="space-y-2 px-3 py-3">
    <div className=" rounded-md overflow-hidden">
        <div className="px-3 h-9 flex items-center bg-muted">
          快捷操作
        </div>
        <div className="bg-background p-3 ">
          <div className="flex gap-1">
            <button
              type="button"
              className="inline-flex h-10 flex-1 items-center justify-center gap-1 rounded-sm text-background bg-foreground hover:bg-foreground/80"
            >
              <Save className="h-4 w-4" /> 保存为 Cue
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
