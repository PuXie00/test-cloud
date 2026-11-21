import { Toaster } from "@/app/components/ui/sonner";
import { AiAppSync } from "./ai-bridge/ai-app-sync";
import { LicenseGate } from "./license/license-gate";
import { AgentShellView } from "@/app/components/agent-shell/view";
import { AppRoutes } from "./routes";

export default function App() {
  return (
    <>
      <LicenseGate>
        <AppRoutes />
        <AgentShellView />
      </LicenseGate>
      <AiAppSync />
      <Toaster richColors position="top-center" />
    </>
  );
}
