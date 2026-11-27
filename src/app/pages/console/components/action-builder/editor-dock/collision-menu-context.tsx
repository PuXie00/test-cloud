import { createContext, useContext, useState, type ReactNode } from "react";

type CollisionMenuAction = { open: () => void; label: string };
const MenuContext = createContext<CollisionMenuAction | null>(null);
const PublishContext = createContext<(action: CollisionMenuAction | null) => void>(() => {});

export const useCollisionMenu = () => useContext(MenuContext);
export const usePublishCollisionMenu = () => useContext(PublishContext);

/** 编辑器持有检测作业；视图菜单只读取命令，收起菜单不影响检测。 */
export const CollisionMenuProvider = ({ children }: { children: ReactNode }) => {
  const [action, publish] = useState<CollisionMenuAction | null>(null);
  return <PublishContext.Provider value={publish}>
    <MenuContext.Provider value={action}>{children}</MenuContext.Provider>
  </PublishContext.Provider>;
};
