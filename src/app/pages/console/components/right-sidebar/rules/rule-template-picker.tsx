import { useState } from "react";
import { Plus } from "lucide-react";
import { cn } from "@/app/components/ui/utils";
import { RULE_TEMPLATES, type RuleTemplate, type RuleTemplateId } from "@/app/pages/console/components/right-sidebar/rules-data";
import { RuleTemplateCard } from "./rule-template-card";

export type RuleTemplateChoice = RuleTemplateId | "blank";

type RuleTemplatePickerProps = {
  onConfirm: (choice: RuleTemplateChoice) => void;
  onCancel?: () => void;
  className?: string;
  variant?: "embedded" | "fullscreen";
  showHeader?: boolean;
};

const btnPrimary =
  "inline-flex h-9 items-center justify-center gap-1.5 rounded-md bg-primary px-4 text-label-caps text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:px-5";
const btnSecondary =
  "inline-flex h-9 items-center justify-center gap-1.5 rounded-md border border-border bg-transparent px-4 text-label-caps text-foreground hover:bg-accent [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:px-5";

export const RuleTemplatePicker = ({ onConfirm, onCancel, className, variant = "embedded", showHeader = true }: RuleTemplatePickerProps) => {
  const [selected, setSelected] = useState<RuleTemplateChoice | null>(null);

  const handlePick = (choice: RuleTemplateChoice) => setSelected(choice);

  const handleConfirm = () => {
    if (!selected) return;
    onConfirm(selected);
  };

  const isFullscreen = variant === "fullscreen";

  return (
    <div
      className={cn(
        "flex flex-col",
        isFullscreen ? "h-full bg-background" : "gap-4",
        className
      )}
      role="group"
      aria-label="选择规则模板"
    >
      {isFullscreen && (
        <header className="shrink-0 border-b border-border bg-card/30 px-4 py-3">
          <h2 className="text-heading-md text-foreground">新建规则 · 选择模板</h2>
          <p className="mt-1 text-body-sm text-muted-foreground">
            从预设模板快速开始，或选择空白画布自定义搭建逻辑。
          </p>
        </header>
      )}

      {!isFullscreen && showHeader && (
        <div>
          <h3 className="text-heading-md text-foreground">选择规则模板</h3>
          <p className="mt-1 text-body-sm text-muted-foreground">
            从预设模板快速开始，或选择空白画布自定义。
          </p>
        </div>
      )}

      <div
        className={cn(
          "custom-scrollbar grid grid-cols-2 gap-2",
          isFullscreen ? "min-h-0 flex-1 overflow-y-auto p-4 sm:grid-cols-3" : "max-h-[360px] overflow-y-auto"
        )}
      >
        {RULE_TEMPLATES.map((t) => (
          <RuleTemplateGridItem
            key={t.id}
            template={t}
            selected={selected === t.id}
            onClick={() => handlePick(t.id)}
          />
        ))}
        <RuleTemplateCard
          name="自定义空白"
          description="从零搭建逻辑节点"
          icon={Plus}
          variant="blank"
          layout="grid"
          selected={selected === "blank"}
          onClick={() => handlePick("blank")}
        />
      </div>

      <footer
        className={cn(
          "flex shrink-0 items-center justify-end gap-2 border-t border-border",
          isFullscreen ? "px-4 py-3" : "pt-2"
        )}
      >
        {onCancel && (
          <button type="button" className={btnSecondary} onClick={onCancel}>
            取消
          </button>
        )}
        <button
          type="button"
          className={btnPrimary}
          disabled={!selected}
          onClick={handleConfirm}
        >
          下一步 · 进入编辑器
        </button>
      </footer>
    </div>
  );
};

type RuleTemplateGridItemProps = {
  template: RuleTemplate;
  selected: boolean;
  onClick: () => void;
};

const RuleTemplateGridItem = ({ template, selected, onClick }: RuleTemplateGridItemProps) => (
  <RuleTemplateCard
    name={template.name}
    description={template.description}
    icon={template.icon}
    layout="grid"
    selected={selected}
    onClick={onClick}
  />
);
