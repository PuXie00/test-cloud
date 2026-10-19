import { useRef } from "react";

/** 按下后横向移动超过这个距离才算拖动，松手时不再当作一次单击 */
export const DRAG_CLICK_THRESHOLD_PX = 3;

/**
 * 拖完松手浏览器还会在这个块上补一次 click，别让它改选中：
 * 按下时清掉记号，拖过了就记下，自己的 click 先问一下是不是拖完补的。
 */
export const useDragClickGuard = () => {
  const draggedRef = useRef(false);
  return {
    pressStarted: () => {
      draggedRef.current = false;
    },
    dragEnded: () => {
      draggedRef.current = true;
    },
    consumeDragClick: (): boolean => {
      const dragged = draggedRef.current;
      draggedRef.current = false;
      return dragged;
    },
  };
};

/** 框选松手后浏览器还会补一次 click（落在哪个元素上说不准），整个窗口吞掉这一次 */
export const suppressNextClick = () => {
  const stop = (event: MouseEvent) => {
    event.stopPropagation();
    event.preventDefault();
  };
  window.addEventListener("click", stop, { capture: true, once: true });
  setTimeout(() => window.removeEventListener("click", stop, { capture: true }), 0);
};

/** Ctrl/⌘ 单击是加选/减选 */
export const isAdditiveClick = (event: Pick<MouseEvent, "ctrlKey" | "metaKey">): boolean =>
  event.ctrlKey || event.metaKey;
