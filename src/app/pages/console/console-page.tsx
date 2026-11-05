import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ActionBuilderProvider } from "./components/action-builder/action-builder-context";
import { ActionBuilderRightSidebar } from "./components/action-builder/action-builder-right-sidebar";
import { ActionBuilderSelectionSync } from "./components/action-builder/action-builder-selection-sync";
import { ContentLibraryPanel } from "./components/action-builder/content-library/content-library-panel";
import { EditorDock } from "./components/action-builder/editor-dock/editor-dock";
import {
  UnsavedLeaveGuard,
  type UnsavedLeaveGuard as LeaveGuard,
} from "./components/action-builder/unsaved-leave-guard";
import { BuildDebugLifecycle } from "./components/build-debug/build-debug-lifecycle";
import { BuildDebugProvider } from "./components/build-debug/build-debug-provider";
import { ConsoleModeProvider, useConsoleMode } from "./hooks/use-console-mode";
import { ConsoleNavProvider, type ConsoleNavOptions } from "./hooks/use-console-nav";
import { ControlledObjectsProvider } from "./hooks/use-controlled-objects";
import { LogStreamProvider } from "./hooks/use-log-stream";
import { useActionCardSeed } from "./hooks/action-card-seed";
import { ExecCardsProvider, useExecCardActions } from "./hooks/use-exec-cards";
import { ExecutorSlotsProvider, type SlotRunOptions } from "./hooks/use-executor-slots";
import { PROGRAM_SLOTS_PER_PAGE } from "./components/program-panel/program-data";
import { compactSlotRunOptions } from "@/app/project/program-item-run-options";
import { sequenceReadyFingerprint } from "./hooks/sequence-execution";
import { ProgramProvider, useProgram } from "./hooks/use-program";
import { useProject } from "@/app/project/use-project";
import { usePermissions } from "@/app/auth/permissions";
import { AiConsoleViewSync } from "@/app/ai-bridge/ai-console-view-sync";
import { SelectionProvider } from "./hooks/selection-provider";
import { AlignmentChecklistProvider } from "./components/drive-debug/alignment-checklist/alignment-checklist-provider";
import { LeftSidebar, type LeftNavId } from "./components/LeftSidebar";
import { RightSidebar, isRightPanelTabAllowed, type RightPanelTab } from "./components/RightSidebar";
import { TopBar } from "./components/TopBar";
import { Viz3DActionPreviewSync } from "./3d/Viz3DActionPreviewSync";
import { Viz3DProvider } from "./3d/Viz3DProvider";
import { Viz3DObjectSync } from "./3d/Viz3DObjectSync";
import { Viz3DProjectModelsSync } from "./3d/Viz3DProjectModelsSync";
import { Viz3DMotorSelectionSync } from "./3d/Viz3DMotorSelectionSync";
import { Viz3DTelemetrySync } from "./3d/Viz3DTelemetrySync";
import { Viz3DHoistTravelSync } from "./3d/Viz3DHoistTravelSync";
import { Viz3DVirtualAxisLabelSync } from "./3d/Viz3DVirtualAxisLabelSync";
import { Viz3DGoShadowSync } from "./3d/Viz3DGoShadowSync";
import { Viz3DSequencePreviewSync } from "./3d/Viz3DSequencePreviewSync";
import { Viz3DMembershipDimSync } from "./3d/Viz3DMembershipDimSync";
import { GoReadyProvider } from "./hooks/go-ready-provider";
import { SequencePreviewProvider } from "./hooks/sequence-preview-provider";
import { Viz3DSelectionSync } from "./3d/Viz3DSelectionSync";
import { StructureSelectionBridge } from "./3d/StructureSelectionBridge";
import { Viz3DConsoleNavSync } from "./3d/Viz3DConsoleNavSync";
import { Viz3DTransformSync } from "./3d/Viz3DTransformSync";
import { ViewportSlot, ViewportSlotProvider } from "./3d/viewport-slot-context";
import { ExecArea } from "./components/exec-area/exec-area";
import { MonitorGrid } from "./components/monitor-grid/monitor-grid";
import { RightTabPanel } from "./components/right-tab-panel/right-tab-panel";
import { ConsoleFooter } from "./components/footer/console-footer";
import { LockScreen } from "./components/lock-screen/lock-screen";
import { ConsoleLoginProvider } from "./components/login-overlay/console-login-context";
import { LoginOverlay } from "./components/login-overlay/login-overlay";
import { ProjectStoreProvider } from "./hooks/use-project-store";
import {
  PlcRuntimeProvider,
  usePlcRuntime,
  useTelemetryListening,
} from "./hooks/plc-runtime-provider";
import { AxisMotionEditLockSync, AxisMotionProvider } from "./hooks/axis-motion";
import { RulesProvider } from "./hooks/use-rules";
import { ControlLayoutProvider, useControlLayout } from "./hooks/use-control-layout";
import { useEmptyProjectWizardEntry } from "./hooks/use-empty-project-wizard-entry";

/**
 * 任务卡里 PLC 没上报的信息（名称、时长、方向等）从当前工程的序列和执行槽取；
 * 聚合状态不正常时不处理 Info|act
 */
const ProjectExecCardsProvider = ({ children }: { children: ReactNode }) => {
  const resolveActionSeed = useActionCardSeed();
  const listening = useTelemetryListening();
  return (
    <ExecCardsProvider resolveActionSeed={resolveActionSeed} listenActionReports={listening}>
      {children}
    </ExecCardsProvider>
  );
};

const ProgramScopedProviders = ({ children }: { children: ReactNode }) => {
  const { pageItems, currentChapterId, currentPageIndex, setItemRunOptions } = useProgram();
  const { currentProject } = useProject();
  const sequenceFingerprints = useMemo(() => {
    const fingerprints: Record<number, string> = {};
    for (const sequence of currentProject?.document.motion.actionSequences ?? []) {
      fingerprints[sequence.id] = sequenceReadyFingerprint(sequence);
    }
    return fingerprints;
  }, [currentProject?.document.motion.actionSequences]);
  const handleSlotRunOptionsChange = useCallback(
    (slotIndex: number, runOptions: SlotRunOptions) => {
      // Slot index is per page; the program item index is across the chapter.
      setItemRunOptions(
        currentChapterId,
        currentPageIndex * PROGRAM_SLOTS_PER_PAGE + slotIndex,
        compactSlotRunOptions(runOptions),
      );
    },
    [currentChapterId, currentPageIndex, setItemRunOptions],
  );
  return (
    <ExecutorSlotsProvider
      pageItems={pageItems}
      sequenceFingerprints={sequenceFingerprints}
      onSlotRunOptionsChange={handleSlotRunOptionsChange}
    >
      {children}
    </ExecutorSlotsProvider>
  );
};

type DevicesRightPanelProps = {
  activeTab: RightPanelTab;
  onTabChange: (tab: RightPanelTab) => void;
};

/** Right panel for the "devices" nav. Wraps RightSidebar in its required context providers. */
const DevicesRightPanel = ({ activeTab, onTabChange }: DevicesRightPanelProps) => (
  <RulesProvider>
    <RightSidebar activeTab={activeTab} onTabChange={onTabChange} />
  </RulesProvider>
);

type ConsoleContentProps = {
  activeNav: LeftNavId;
  isShow: boolean;
  devicesRightTab: RightPanelTab;
  onDevicesTabChange: (tab: RightPanelTab) => void;
};

/**
 * The main content area.  ViewportSlot lives here at a STABLE position in the
 * React tree so the canvas (and Babylon engine) never unmounts when the user
 * switches navigation tabs.  Only the panels around the canvas change.
 */
const ConsoleContent = ({
  activeNav,
  isShow,
  devicesRightTab,
  onDevicesTabChange,
}: ConsoleContentProps) => {
  const { monitorPanelVisible, rightPanelVisible } = useControlLayout();

  const isControl = activeNav === "control";
  const isDevices = activeNav === "devices" && !isShow;
  const isSequences = activeNav === "sequences" && !isShow;

  return (
    <>
      <section className="flex min-h-0 min-w-0 flex-1 flex-col gap-1">
        <div className={`flex min-h-0 overflow-hidden gap-1 ${isControl ? "flex-[3]" : "flex-1"}`}>
          <div className="flex min-h-0 min-w-0 flex-1 gap-1">
            <ViewportSlot />

            {isSequences && <ContentLibraryPanel className="h-full w-[240px] shrink-0" />}

            {isControl && monitorPanelVisible && (
              <MonitorGrid className="w-[42%] shrink-0" />
            )}
            {isDevices && (
              <DevicesRightPanel activeTab={devicesRightTab} onTabChange={onDevicesTabChange} />
            )}
          </div>
        </div>

        {isControl && <ExecArea className="h-[300px]" />}
        {isSequences && <EditorDock />}
      </section>

      {isControl && rightPanelVisible && (
        <RightTabPanel className="w-70 shrink-0" />
      )}
      {isSequences && <ActionBuilderRightSidebar />}
    </>
  );
};

const ConsoleInner = () => {
  const { mode } = useConsoleMode();
  const { emergencyStopAll } = useExecCardActions();
  const { allStopAll } = usePlcRuntime();
  const { can } = usePermissions();
  const [activeNav, setActiveNav] = useState<LeftNavId>("control");
  const [devicesRightTab, setDevicesRightTab] = useState<RightPanelTab>("structure");

  const isShow = mode === "show";

  useEffect(() => {
    if (isShow) setActiveNav("control");
  }, [isShow]);

  // 换了用户（或退出）后，没有权限的页面回到「控制」；只切界面，不碰设备
  const navAllowed =
    activeNav === "control" ||
    (activeNav === "devices" && can("build.view")) ||
    (activeNav === "sequences" && can("action.view"));
  const devicesTabAllowed = isRightPanelTabAllowed(devicesRightTab, can);
  useEffect(() => {
    if (!navAllowed) setActiveNav("control");
  }, [navAllowed]);
  useEffect(() => {
    if (!devicesTabAllowed) setDevicesRightTab("structure");
  }, [devicesTabAllowed]);

  const enterConfigWizard = useCallback(() => {
    setActiveNav("devices");
    setDevicesRightTab("wizard");
  }, []);
  useEmptyProjectWizardEntry({ isShow, onEnter: enterConfigWizard });

  const handleEmergencyStop = () => {
    emergencyStopAll();
    void allStopAll();
  };

  // 用户切页面（左侧导航、页面里的跳转）离开动作页时，有未保存的序列先弹窗；
  // 切演出模式、权限变化引起的跳转不拦
  const leaveGuardRef = useRef<LeaveGuard | null>(null);
  const requestNav = (id: LeftNavId, options?: ConsoleNavOptions) => {
    const proceed = () => {
      setActiveNav(id);
      if (options?.devicesTab) setDevicesRightTab(options.devicesTab);
    };
    if (activeNav === "sequences" && id !== "sequences" && leaveGuardRef.current?.(proceed)) return;
    proceed();
  };

  return (
    <ControlLayoutProvider>
      <Viz3DProvider>
        <ConsoleNavProvider
          activeNav={activeNav}
          navigate={requestNav}
        >
          <SequencePreviewProvider>
            <GoReadyProvider>
              <ViewportSlotProvider>
            <div className="flex h-screen w-full flex-col overflow-hidden bg-background text-body-md text-foreground">
              <TopBar onStop={handleEmergencyStop} />

              <main className="flex min-h-0 flex-1 overflow-hidden gap-1 pr-1">
                {!isShow && (
                  <LeftSidebar
                    active={activeNav}
                    onChange={requestNav}
                    className="h-full shrink-0"
                  />
                )}

                <ConsoleContent
                  activeNav={activeNav}
                  isShow={isShow}
                  devicesRightTab={devicesRightTab}
                  onDevicesTabChange={setDevicesRightTab}
                />
              </main>

              <ConsoleFooter />
              <LockScreen />
              <LoginOverlay />
              <Viz3DObjectSync />
              <Viz3DProjectModelsSync />
              <Viz3DMotorSelectionSync />
              <Viz3DConsoleNavSync />
              <Viz3DTelemetrySync />
              <Viz3DHoistTravelSync />
              <Viz3DSequencePreviewSync />
              <Viz3DActionPreviewSync />
              <Viz3DVirtualAxisLabelSync />
              <Viz3DGoShadowSync />
              <Viz3DMembershipDimSync />
              <Viz3DTransformSync />
              <Viz3DSelectionSync />
              <ActionBuilderSelectionSync />
              <UnsavedLeaveGuard guardRef={leaveGuardRef} />
              <StructureSelectionBridge />
              <BuildDebugLifecycle />
              <AiConsoleViewSync devicesTab={devicesRightTab} />
            </div>
              </ViewportSlotProvider>
            </GoReadyProvider>
          </SequencePreviewProvider>
        </ConsoleNavProvider>
      </Viz3DProvider>
    </ControlLayoutProvider>
  );
};

export const ConsolePage = () => (
  <AxisMotionProvider>
    <AxisMotionEditLockSync />
    <ConsoleModeProvider>
      <SelectionProvider>
        <ProgramProvider>
          <ProgramScopedProviders>
            <ProjectStoreProvider>
              <PlcRuntimeProvider>
                <ProjectExecCardsProvider>
                  <ControlledObjectsProvider>
                    <LogStreamProvider>
                      <ActionBuilderProvider>
                        <AlignmentChecklistProvider>
                          <BuildDebugProvider>
                            <ConsoleLoginProvider>
                              <ConsoleInner />
                            </ConsoleLoginProvider>
                          </BuildDebugProvider>
                        </AlignmentChecklistProvider>
                      </ActionBuilderProvider>
                    </LogStreamProvider>
                  </ControlledObjectsProvider>
                </ProjectExecCardsProvider>
              </PlcRuntimeProvider>
            </ProjectStoreProvider>
          </ProgramScopedProviders>
        </ProgramProvider>
      </SelectionProvider>
    </ConsoleModeProvider>
  </AxisMotionProvider>
);
