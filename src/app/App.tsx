import { Toaster } from "@/app/components/ui/sonner";
import { AiAppSync } from "./ai-bridge/ai-app-sync";
import { AppRoutes } from "./routes";

export default function App() {
  return (
    <>
      <AppRoutes />
      <AiAppSync />
      <Toaster richColors position="top-center" />
    </>
  );
}
