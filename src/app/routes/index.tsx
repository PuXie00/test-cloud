import { Navigate, Route, Routes } from "react-router";
import { useAuth } from "@/app/auth/use-auth";
import { useProject } from "@/app/project/use-project";
import { ConsolePage } from "@/app/pages/console/console-page";
import { LoginPage } from "@/app/pages/login/login-page";
import { ProjectCenterPage } from "@/app/pages/project-center/project-center-page";
import { RuleGraphEditorPage } from "@/app/pages/rule-editor/rule-graph-editor-page";
import { ProtectedRoute } from "./protected-route";
import { ProjectGate } from "./project-gate";
import { RootRedirect } from "./root-redirect";

const LoginGate = () => {
  const { isAuthenticated } = useAuth();
  if (isAuthenticated) return <Navigate to="/project-center" replace />;
  return <LoginPage />;
};

const CatchAllRedirect = () => {
  const { isAuthenticated } = useAuth();
  const { currentProject } = useProject();
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (currentProject) return <Navigate to="/console" replace />;
  return <Navigate to="/project-center" replace />;
};

const WithProjectGate = ({ children }: { children: React.ReactNode }) => (
  <ProjectGate>{children}</ProjectGate>
);

export const AppRoutes = () => (
  <Routes>
    <Route path="/" element={<RootRedirect />} />
    <Route path="/login" element={<LoginGate />} />
    <Route
      path="/project-center"
      element={
        <ProtectedRoute>
          <ProjectCenterPage />
        </ProtectedRoute>
      }
    />
    <Route
      path="/console"
      element={
        <ProtectedRoute>
          <WithProjectGate>
            <ConsolePage />
          </WithProjectGate>
        </ProtectedRoute>
      }
    />
    <Route
      path="/console/rule/:id"
      element={
        <ProtectedRoute>
          <WithProjectGate>
            <RuleGraphEditorPage />
          </WithProjectGate>
        </ProtectedRoute>
      }
    />
    <Route path="*" element={<CatchAllRedirect />} />
  </Routes>
);
