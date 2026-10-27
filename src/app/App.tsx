import { Toaster } from "@/app/components/ui/sonner";
import { AiAppSync } from "./ai-bridge/ai-app-sync";
import { LicenseGate } from "./license/license-gate";
import { AppRoutes } from "./routes";

export default function App() {
  return (
    <>
      <LicenseGate>
        <AppRoutes />
      </LicenseGate>
      <AiAppSync />
      <Toaster richColors position="top-center" />
    </>
  );
}
