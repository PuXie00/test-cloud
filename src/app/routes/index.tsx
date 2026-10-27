import { Navigate, Route, Routes } from "react-router";
import { useAuth } from "@/app/auth/use-auth";
import { usePermissions } from "@/app/auth/permissions";
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

/** 规则编辑器要有「编辑安全规则」权限 */
const RulesGate = ({ children }: { children: React.ReactNode }) => {
  const { can } = usePermissions();
  if (!can("build.rules")) return <Navigate to="/console" replace />;
  return <>{children}</>;
};

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
    {/* 控制台不因退出登录跳走：没有会话时控制台原地显示登录框，设备与界面状态都保留 */}
    <Route
      path="/console"
      element={
        <WithProjectGate>
          <ConsolePage />
        </WithProjectGate>
      }
    />
    <Route
      path="/console/rule/:id"
      element={
        <ProtectedRoute>
          <WithProjectGate>
            <RulesGate>
              <RuleGraphEditorPage />
            </RulesGate>
          </WithProjectGate>
        </ProtectedRoute>
      }
    />
    <Route path="*" element={<CatchAllRedirect />} />
  </Routes>
);
