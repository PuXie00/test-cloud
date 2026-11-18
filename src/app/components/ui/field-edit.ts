import {
  useRef,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
} from "react";

/**
 * 输入框的编辑手感（NumericInput 与 Input 共用）：
 * - 获得焦点就全选（鼠标点、触摸点、Tab 都一样），打字直接替换，删除键一次清空；
 * - Enter 提交，Esc 放弃本次修改；
 * - 中文输入法组字时的 Enter / Esc 归输入法，不当作提交 / 放弃。
 */

export type FieldEditKey = "commit" | "cancel";

/** 输入法组字中（keyCode 229 是部分浏览器组字时的按键码） */
export const isComposingKey = (event: KeyboardEvent<Element>): boolean =>
  event.nativeEvent.isComposing === true || event.keyCode === 229;

export const resolveFieldEditKey = (
  event: KeyboardEvent<Element>,
): FieldEditKey | null => {
  if (isComposingKey(event)) return null;
  if (event.key === "Enter") return "commit";
  if (event.key === "Escape") return "cancel";
  return null;
};

/** 能全选文字的 input 类型（checkbox / radio / range 等没有文字可选） */
const TEXT_LIKE_TYPES = new Set(["", "text", "search", "url", "tel", "email", "password", "number"]);

export const selectAllText = (input: HTMLInputElement) => {
  if (!TEXT_LIKE_TYPES.has(input.type)) return;
  input.select();
};

/**
 * 像用户亲手改值一样写入：走原生 setter 再派发 input 事件，
 * React onChange、react-hook-form register、ProjectEditBoundary 的 change 捕获都能收到。
 */
export const setInputValueAsUser = (input: HTMLInputElement, value: string) => {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  if (!setter) return;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
};

export type FieldEditOptions = {
  /** 获得焦点时全选，默认开 */
  selectOnFocus?: boolean;
  onCommitKey?: (event: KeyboardEvent<HTMLInputElement>) => void;
  onCancelKey?: (event: KeyboardEvent<HTMLInputElement>) => void;
};

export type FieldEditHandlers = {
  onMouseDown: (event: MouseEvent<HTMLInputElement>) => void;
  onMouseUp: (event: MouseEvent<HTMLInputElement>) => void;
  onFocus: (event: FocusEvent<HTMLInputElement>) => void;
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
};

/**
 * 返回要挂到 `<input>` 上的处理函数（调用方自己的同名处理函数由调用方串起来）。
 *
 * 点进来时 Chrome 在 mouseup 把光标放到点击处、冲掉 focus 里的全选，
 * 所以“这一下点击让它获得焦点”时吞掉那一次 mouseup；已经有焦点时再点，照常定位光标。
 * 触摸点按会合成同样的 mousedown / mouseup，走同一条路。
 */
export const useFieldEdit = ({
  selectOnFocus = true,
  onCommitKey,
  onCancelKey,
}: FieldEditOptions = {}): FieldEditHandlers => {
  const focusingClickRef = useRef(false);

  return {
    onMouseDown: (event) => {
      focusingClickRef.current =
        selectOnFocus && event.button === 0 && document.activeElement !== event.currentTarget;
    },
    onMouseUp: (event) => {
      if (!focusingClickRef.current) return;
      focusingClickRef.current = false;
      event.preventDefault();
    },
    onFocus: (event) => {
      if (selectOnFocus) selectAllText(event.currentTarget);
    },
    onKeyDown: (event) => {
      const key = resolveFieldEditKey(event);
      if (key === "commit") onCommitKey?.(event);
      else if (key === "cancel") onCancelKey?.(event);
    },
  };
};
