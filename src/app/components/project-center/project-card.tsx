import { MoreVertical, Theater } from "lucide-react";
import { cn } from "@/app/components/ui/utils";
import type { ProjectRecord } from "@/app/project/project-types";

type ProjectCardProps = {
  project: ProjectRecord;
  selected: boolean;
  onSelect: () => void;
};

const statusBadge = (status: ProjectRecord["status"]) => {
  if (status === "active") return { label: "ACTIVE", className: "bg-show/20 text-show" };
  if (status === "draft") return { label: "DRAFT", className: "bg-warning-surface text-warning" };
  return { label: "已归档", className: "bg-muted text-muted-foreground" };
};

export const ProjectCard = ({ project, selected, onSelect }: ProjectCardProps) => {

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "flex w-full flex-col overflow-hidden rounded-lg bg-card text-left transition-shadow",
        selected ? "ring-2 ring-primary shadow-[0_0_24px] shadow-primary/10" : "ring-1 ring-border hover:ring-primary/40",
        project.status === "archived" && "opacity-60",
      )}
    >
      <div className="relative aspect-video w-full bg-muted">
        {project.coverDataUrl ? (
          <img
            src={project.coverDataUrl}
            alt=""
            className="absolute inset-0 h-full w-full object-cover"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-muted to-background">
            <Theater className="h-10 w-10 text-muted-foreground/50" aria-hidden />
          </div>
        )}
      </div>
      <div className="flex flex-col gap-2 p-4">
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-heading-md font-semibold text-foreground">{project.name}</h3>
          <span
            className="shrink-0 text-muted-foreground"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
            role="presentation"
          >
            <MoreVertical className="h-4 w-4" aria-hidden />
          </span>
        </div>
        <p className="font-mono text-mono-sm text-muted-foreground">Mod: {project.modifiedAt}</p>
        <div className="flex flex-wrap gap-2">
          {project.tags.map((tag) => (
            <span
              key={tag}
              className="rounded-full bg-muted px-2 py-0.5 text-body-sm text-muted-foreground"
            >
              {tag}
            </span>
          ))}
        </div>
      </div>
    </button>
  );
};
