import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ActionBuilderProvider } from "./components/action-builder/action-builder-context";
import { ActionBuilderRightSidebar } from "./components/action-builder/action-builder-right-sidebar";
import { ActionBuilderSelectionSync } from "./components/action-builder/action-builder-selection-sync";
import { ContentLibraryPanel } from "./components/action-builder/content-library/content-library-panel";
import { EditorDock } from "./components/action-builder/editor-dock/editor-dock";
import { BuildDebugLifecycle } from "./components/build-debug/build-debug-lifecycle";
import { BuildDebugProvider } from "./components/build-debug/build-debug-provider";
import { ConsoleModeProvider, useConsoleMode } from "./hooks/use-console-mode";
import { ConsoleNavProvider } from "./hooks/use-console-nav";
import { ControlledObjectsProvider } from "./hooks/use-controlled-objects";
import { LogStreamProvider } from "./hooks/use-log-stream";
import { ExecCardsProvider, useExecCards } from "./hooks/use-exec-cards";
import { ExecutorSlotsProvider } from "./hooks/use-executor-slots";
import { sequenceReadyFingerprint } from "./hooks/sequence-execution";
import { ProgramProvider, useProgram } from "./hooks/use-program";
import { useProject } from "@/app/project/use-project";
import { SelectionProvider } from "./hooks/selection-provider";
import { AlignmentChecklistProvider } from "./components/drive-debug/alignment-checklist/alignment-checklist-provider";
import { LeftSidebar, type LeftNavId } from "./components/LeftSidebar";
import { RightSidebar, type RightPanelTab } from "./components/RightSidebar";
import { TopBar } from "./components/TopBar";
import { Viz3DActionPreviewSync } from "./3d/Viz3DActionPreviewSync";
import { Viz3DProvider } from "./3d/Viz3DProvider";
import { Viz3DObjectSync } from "./3d/Viz3DObjectSync";
import { Viz3DProjectModelsSync } from "./3d/Viz3DProjectModelsSync";
import { Viz3DMotorSelectionSync } from "./3d/Viz3DMotorSelectionSync";
import { Viz3DTelemetrySync } from "./3d/Viz3DTelemetrySync";
import { Viz3DVirtualAxisLabelSync } from "./3d/Viz3DVirtualAxisLabelSync";
import { Viz3DGoShadowSync } from "./3d/Viz3DGoShadowSync";
import { Viz3DMembershipDimSync } from "./3d/Viz3DMembershipDimSync";
import { GoReadyProvider } from "./hooks/go-ready-provider";
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
import { ConfigWizardProvider } from "./hooks/use-config-wizard";
import { ProjectStoreProvider } from "./hooks/use-project-store";
import { PlcRuntimeProvider, usePlcRuntime } from "./hooks/plc-runtime-provider";
import { RulesProvider } from "./hooks/use-rules";
import { ControlLayoutProvider, useControlLayout } from "./hooks/use-control-layout";
import { NEW_PROJECT_FLAG_KEY } from "./components/right-sidebar/config-wizard/config-wizard-constants";

const ProgramScopedProviders = ({ children }: { children: ReactNode }) => {
  const { pageItems } = useProgram();
  const { currentProject } = useProject();
  const sequenceFingerprints = useMemo(() => {
    const fingerprints: Record<number, string> = {};
    for (const sequence of currentProject?.document.motion.actionSequences ?? []) {
      fingerprints[sequence.id] = sequenceReadyFingerprint(sequence);
    }
    return fingerprints;
  }, [currentProject?.document.motion.actionSequences]);
  return (
    <ExecutorSlotsProvider pageItems={pageItems} sequenceFingerprints={sequenceFingerprints}>
      {children}
    </ExecutorSlotsProvider>
  );
};

type DevicesRightPanelProps = {
  activeTab: RightPanelTab;
  onTabChange: (tab: RightPanelTab) => void;
};

/**
 * Right panel for the "devices" nav. Wraps RightSidebar in its required
 * context providers and handles the new-project auto-wizard trigger.
 */
const DevicesRightPanel = ({ activeTab, onTabChange }: DevicesRightPanelProps) => {
  useEffect(() => {
    const isNew = sessionStorage.getItem(NEW_PROJECT_FLAG_KEY) === "1";
    if (isNew) {
      sessionStorage.removeItem(NEW_PROJECT_FLAG_KEY);
      const timer = window.setTimeout(() => onTabChange("wizard"), 300);
      return () => window.clearTimeout(timer);
    }
  }, [onTabChange]);

  return (
    <ConfigWizardProvider>
      <RulesProvider>
        <RightSidebar activeTab={activeTab} onTabChange={onTabChange} />
      </RulesProvider>
    </ConfigWizardProvider>
  );
};

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

        {isControl && <ExecArea className="h-[260px]" />}
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
  const { emergencyStopAll } = useExecCards();
  const { allStopAll } = usePlcRuntime();
  const [activeNav, setActiveNav] = useState<LeftNavId>("control");
  const [devicesRightTab, setDevicesRightTab] = useState<RightPanelTab>("structure");

  const isShow = mode === "show";

  useEffect(() => {
    if (isShow) setActiveNav("control");
  }, [isShow]);

  const handleEmergencyStop = () => {
    emergencyStopAll();
    void allStopAll();
  };

  return (
    <ControlLayoutProvider>
      <Viz3DProvider>
        <ConsoleNavProvider
          activeNav={activeNav}
          navigate={(id, options) => {
            setActiveNav(id);
            if (options?.devicesTab) setDevicesRightTab(options.devicesTab);
          }}
        >
          <GoReadyProvider>
            <ViewportSlotProvider>
            <div className="flex h-screen w-full flex-col overflow-hidden bg-background text-body-md text-foreground">
              <TopBar onStop={handleEmergencyStop} />

              <main className="flex min-h-0 flex-1 overflow-hidden gap-1 pr-1">
                {!isShow && (
                  <LeftSidebar
                    active={activeNav}
                    onChange={setActiveNav}
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
              <Viz3DObjectSync />
              <Viz3DProjectModelsSync />
              <Viz3DMotorSelectionSync />
              <Viz3DConsoleNavSync />
              <Viz3DTelemetrySync />
              <Viz3DActionPreviewSync />
              <Viz3DVirtualAxisLabelSync />
              <Viz3DGoShadowSync />
              <Viz3DMembershipDimSync />
              <Viz3DTransformSync />
              <Viz3DSelectionSync />
              <ActionBuilderSelectionSync />
              <StructureSelectionBridge />
              <BuildDebugLifecycle />
            </div>
          </ViewportSlotProvider>
          </GoReadyProvider>
        </ConsoleNavProvider>
      </Viz3DProvider>
    </ControlLayoutProvider>
  );
};

export const ConsolePage = () => (
  <ConsoleModeProvider>
    <SelectionProvider>
      <ProgramProvider>
        <ProgramScopedProviders>
          <ExecCardsProvider>
            <ProjectStoreProvider>
              <PlcRuntimeProvider>
                <ControlledObjectsProvider>
                  <LogStreamProvider>
                    <ActionBuilderProvider>
                      <AlignmentChecklistProvider>
                        <BuildDebugProvider>
                          <ConsoleInner />
                        </BuildDebugProvider>
                      </AlignmentChecklistProvider>
                    </ActionBuilderProvider>
                  </LogStreamProvider>
                </ControlledObjectsProvider>
              </PlcRuntimeProvider>
            </ProjectStoreProvider>
          </ExecCardsProvider>
        </ProgramScopedProviders>
      </ProgramProvider>
    </SelectionProvider>
  </ConsoleModeProvider>
);
