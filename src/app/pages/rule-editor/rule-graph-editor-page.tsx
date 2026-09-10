import { useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import { ArrowLeft, PlayCircle, Save } from "lucide-react";
import { Switch } from "@/app/components/ui/switch";
import { cn } from "@/app/components/ui/utils";
import { RuleTemplatePicker, type RuleTemplateChoice } from "@/app/pages/console/components/right-sidebar/rules/rule-template-picker";
import { INITIAL_RULES, RULE_TEMPLATES, type RuleTemplateId } from "@/app/pages/console/components/right-sidebar/rules-data";
import { NodePalette } from "./components/node-palette";
import { NodeCanvas } from "./components/node-canvas";
import { NodeInspector } from "./components/node-inspector";

const btnPrimary =
  "inline-flex h-8 items-center justify-center gap-1.5 rounded-md bg-primary px-3 text-label-caps text-primary-foreground hover:opacity-90 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:px-4";
const btnGhost =
  "inline-flex h-8 items-center justify-center gap-1.5 rounded-md px-3 text-label-caps text-muted-foreground hover:bg-accent hover:text-foreground [@media(pointer:coarse)]:h-11";

const isValidTemplateId = (value: string | null): value is RuleTemplateId =>
  RULE_TEMPLATES.some((t) => t.id === value);

const resolveTemplateChoice = (raw: string | null): RuleTemplateChoice | null => {
  if (!raw) return null;
  if (raw === "blank") return "blank";
  return isValidTemplateId(raw) ? raw : null;
};

export const RuleGraphEditorPage = () => {
  const { id } = useParams<{ id: string }>();
  const [params] = useSearchParams();
  const navigate = useNavigate();

  const isNew = id === "new";
  const rawTemplate = params.get("template");
  const templateChoice = resolveTemplateChoice(rawTemplate);

  const existing = useMemo(
    () => (!isNew && id ? INITIAL_RULES.find((r) => r.id === id) ?? null : null),
    [id, isNew]
  );

  const template = useMemo(() => {
    if (templateChoice && templateChoice !== "blank") {
      return RULE_TEMPLATES.find((t) => t.id === templateChoice) ?? null;
    }
    if (existing?.templateId) {
      return RULE_TEMPLATES.find((t) => t.id === existing.templateId) ?? null;
    }
    return null;
  }, [templateChoice, existing]);

  const [name, setName] = useState<string>(
    existing?.name ?? (templateChoice === "blank" ? "新规则" : template?.name ?? "新规则")
  );
  const [enabled, setEnabled] = useState<boolean>(existing?.enabled ?? false);
  const [dirty, setDirty] = useState(false);

  const handleExit = async () => {
    if (dirty) {
      const ok = await window.toolAPI.confirm({
        title: "退出编辑器",
        message: "有未保存的修改，确认退出？",
      });
      if (!ok) return;
    }
    navigate("/console");
  };

  const handleTemplateConfirm = (choice: RuleTemplateChoice) => {
    const next = choice === "blank" ? "/console/rule/new?template=blank" : `/console/rule/new?template=${choice}`;
    navigate(next, { replace: true });
  };

  if (isNew && !templateChoice) {
    return (
      <div className="flex h-screen w-full flex-col overflow-hidden bg-background text-body-md text-foreground">
        <RuleTemplatePicker
          variant="fullscreen"
          onConfirm={handleTemplateConfirm}
          onCancel={handleExit}
        />
      </div>
    );
  }

  return (
    <div className="flex h-screen w-full flex-col overflow-hidden bg-background text-body-md text-foreground">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border bg-card/30 px-3 [@media(pointer:coarse)]:h-14">
        <button type="button" onClick={handleExit} aria-label="退出编辑器" className={btnGhost}>
          <ArrowLeft className="h-4 w-4" aria-hidden /> 返回
        </button>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <input
            type="text"
            value={name}
            onChange={(e) => { setName(e.target.value); setDirty(true); }}
            aria-label="规则名称"
            className={cn(
              "h-8 min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-2 text-body-md text-foreground outline-none hover:border-border focus:border-primary",
              "[@media(pointer:coarse)]:h-10"
            )}
          />
          {template && (
            <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-label-caps text-muted-foreground">
              模板 · {template.name}
            </span>
          )}
          {templateChoice === "blank" && (
            <span className="shrink-0 rounded-full border border-dashed border-border px-2 py-0.5 text-label-caps text-muted-foreground">
              自定义空白
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <label className="flex items-center gap-2 text-body-sm text-muted-foreground">
            启用 <Switch checked={enabled} onCheckedChange={setEnabled} aria-label="启用规则" />
          </label>
          <button type="button" className={btnGhost}>
            <PlayCircle className="h-4 w-4" aria-hidden /> 测试
          </button>
          <button type="button" className={btnPrimary} onClick={() => setDirty(false)}>
            <Save className="h-4 w-4" aria-hidden /> 保存
          </button>
        </div>
      </header>
      <main className="flex min-h-0 flex-1 overflow-hidden">
        <NodePalette />
        <NodeCanvas templateName={template?.name ?? (templateChoice === "blank" ? "空白画布" : undefined)} />
        <NodeInspector />
      </main>
    </div>
  );
};
