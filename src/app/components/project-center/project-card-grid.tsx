import type { ProjectRecord } from "@/app/project/project-types";
import { ProjectCard } from "./project-card";

type ProjectCardGridProps = {
  projects: ProjectRecord[];
  selectedId: string | null;
  onSelect: (id: string) => void;
};

export const ProjectCardGrid = ({ projects, selectedId, onSelect }: ProjectCardGridProps) => {
  if (projects.length === 0) {
    return (
      <div className="flex min-h-[200px] items-center justify-center text-body-md text-muted-foreground">
        暂无匹配的工程
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-5 pb-4 md:grid-cols-2 xl:grid-cols-3 p-2">
      {projects.map((project) => (
        <ProjectCard
          key={project.id}
          project={project}
          selected={project.id === selectedId}
          onSelect={() => onSelect(project.id)}
        />
      ))}
    </div>
  );
};
