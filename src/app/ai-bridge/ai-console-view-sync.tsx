import { useEffect, useMemo } from "react";
import { AI_VIEW_PUBLISH_MS } from "@shared/ai-bridge/protocol";
import { useProject } from "@/app/project/use-project";
import type { RightPanelTab } from "@/app/pages/console/components/RightSidebar";
import { useActionBuilder } from "@/app/pages/console/components/action-builder/use-action-builder";
import { useConsoleMode } from "@/app/pages/console/hooks/use-console-mode";
import { useConsoleNav } from "@/app/pages/console/hooks/use-console-nav";
import { useControlLayout } from "@/app/pages/console/hooks/use-control-layout";
import { useSelection } from "@/app/pages/console/hooks/use-selection";
import { buildAiConsoleView, buildAiEntityNames } from "./ai-view";
import { publishAiMessage, useAiPublish } from "./use-ai-publish";

type AiConsoleViewSyncProps = {
  /** 搭建页右侧 Tab 是 ConsoleInner 的本地状态 */
  devicesTab: RightPanelTab;
};

/** 控制台：把导航、Tab、选中的物体 / 电机 / 动作序列推给本地 AI 服务 */
export const AiConsoleViewSync = ({ devicesTab }: AiConsoleViewSyncProps) => {
  const { mode } = useConsoleMode();
  const { activeNav } = useConsoleNav();
  const { activeRightTab: controlTab, rightPanelVisible } = useControlLayout();
  const { activeRightTab: sequencesTab, selectedSequenceId } = useActionBuilder();
  const { selectedId, multiSelectedIds, multiSelectedMotorIds, treeFocus } = useSelection();
  const { currentProject } = useProject();
  const document = currentProject?.document;

  const names = useMemo(
    () =>
      document
        ? buildAiEntityNames(document)
        : { plcs: {}, motors: {}, objects: {}, sequences: {} },
    [document],
  );

  const view = useMemo(
    () =>
      buildAiConsoleView({
        mode,
        nav: activeNav,
        devicesTab,
        controlTab,
        controlPanelVisible: rightPanelVisible,
        sequencesTab,
        selectedObjectId: selectedId,
        multiSelectedObjectIds: multiSelectedIds,
        multiSelectedMotorIds,
        treeFocus,
        selectedSequenceId,
        names,
      }),
    [
      mode,
      activeNav,
      devicesTab,
      controlTab,
      rightPanelVisible,
      sequencesTab,
      selectedId,
      multiSelectedIds,
      multiSelectedMotorIds,
      treeFocus,
      selectedSequenceId,
      names,
    ],
  );
  const key = useMemo(() => JSON.stringify(view), [view]);
  useAiPublish(key, () => ({ type: "console", data: view }), AI_VIEW_PUBLISH_MS);

  useEffect(() => () => publishAiMessage({ type: "console", data: null }), []);

  return null;
};
