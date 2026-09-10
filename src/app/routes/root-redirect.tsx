import { Navigate } from "react-router";
import { useAuth } from "@/app/auth/use-auth";
import { useProject } from "@/app/project/use-project";

export const RootRedirect = () => {
  const { isAuthenticated } = useAuth();
  const { currentProject } = useProject();
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (currentProject) return <Navigate to="/console" replace />;
  return <Navigate to="/project-center" replace />;
};
