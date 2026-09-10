import { Navigate } from "react-router";
import { useProject } from "@/app/project/use-project";

export const ProjectGate = ({ children }: { children: React.ReactNode }) => {
  const { currentProject } = useProject();
  if (!currentProject) {
    return <Navigate to="/project-center" replace />;
  }
  return <>{children}</>;
};
