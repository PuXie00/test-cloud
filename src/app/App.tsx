import { Toaster } from "@/app/components/ui/sonner";
import { AppRoutes } from "./routes";

export default function App() {
  return (
    <>
      <AppRoutes />
      <Toaster richColors position="top-center" />
    </>
  );
}
