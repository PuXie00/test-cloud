import { useEffect, useRef } from "react";
import { usePermissions } from "@/app/auth/permissions";
import { useProject } from "@/app/project/use-project";

type EmptyProjectWizardEntryOptions = {
  isShow: boolean;
  onEnter: () => void;
};

/**
 * 打开空工程时进入配置向导。每次打开只触发一次：之后用户离开向导、
 * 换用户或工程内容变化都不再跳转；演出模式和没有编辑权限时不跳。
 */
export const useEmptyProjectWizardEntry = ({ isShow, onEnter }: EmptyProjectWizardEntryOptions) => {
  const { currentProject } = useProject();
  const canEdit = usePermissions().can("build.edit");
  const handledProjectIdRef = useRef<string | null>(null);
  const projectId = currentProject?.id ?? null;
  const setup = currentProject?.document?.setup;

  useEffect(() => {
    if (!projectId || !setup) return;
    if (handledProjectIdRef.current === projectId) return;
    handledProjectIdRef.current = projectId;
    if (isShow || !canEdit) return;
    const empty =
      setup.controlledObjects.length === 0 && setup.plcs.length === 0 && setup.motors.length === 0;
    if (empty) onEnter();
  }, [canEdit, isShow, onEnter, projectId, setup]);
};
