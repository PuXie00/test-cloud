import { ProjectCenterScreen } from "@/app/components/project-center";

/** 登录后 / 无当前工程时的独立路由页 */
export const ProjectCenterPage = () => (
  <div className="h-screen w-full">
    <ProjectCenterScreen presentation="page" />
  </div>
);
