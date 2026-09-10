import { Clapperboard } from "lucide-react";
import { GoToSequencesButton } from "./go-to-sequences-button";

export const ProgramEmptyGuide = () => (
  <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 py-10 text-center">
    <div className="flex h-12 w-12 items-center justify-center rounded-md bg-muted">
      <Clapperboard className="h-6 w-6 text-muted-foreground" aria-hidden />
    </div>
    <div className="space-y-1.5">
      <p className="text-body-md font-medium text-foreground">尚未编排节目</p>
      <p className="max-w-[220px] text-body-sm text-muted-foreground">
        请先在动作界面创建 Cue、动作序列，并组装为节目章节后再回到控制界面执行。
      </p>
    </div>
    <GoToSequencesButton />
  </div>
);
