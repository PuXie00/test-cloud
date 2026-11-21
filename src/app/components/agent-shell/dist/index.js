import { jsx, jsxs, Fragment } from "react/jsx-runtime";
import { useRef, useState, useEffect, useContext, createContext, forwardRef, createElement, useCallback, useLayoutEffect } from "react";
function AgentFrame({
  elementRef,
  entryUrl,
  title,
  visible
}) {
  return /* @__PURE__ */ jsx(
    "iframe",
    {
      ref: elementRef,
      className: "pando-agent-shell__frame",
      "data-loaded": visible,
      src: entryUrl,
      title
    }
  );
}
function StartupFailure({
  message,
  onRetry
}) {
  return /* @__PURE__ */ jsxs("div", { className: "pando-agent-shell__failure", role: "alert", children: [
    /* @__PURE__ */ jsx("strong", { children: "智能向导启动失败" }),
    message && /* @__PURE__ */ jsx("span", { children: message }),
    /* @__PURE__ */ jsx("button", { type: "button", onClick: onRetry, children: "重新连接" })
  ] });
}
function StartupLoading() {
  return /* @__PURE__ */ jsxs(
    "div",
    {
      "aria-label": "正在连接智能向导",
      className: "pando-agent-shell__loading",
      role: "status",
      children: [
        /* @__PURE__ */ jsxs(
          "div",
          {
            className: "pando-agent-shell__loading-conversation",
            "aria-hidden": "true",
            children: [
              /* @__PURE__ */ jsx("span", { className: "pando-agent-shell__loading-bubble pando-agent-shell__loading-bubble--1" }),
              /* @__PURE__ */ jsx("span", { className: "pando-agent-shell__loading-bubble pando-agent-shell__loading-bubble--2" }),
              /* @__PURE__ */ jsx("span", { className: "pando-agent-shell__loading-bubble pando-agent-shell__loading-bubble--3" }),
              /* @__PURE__ */ jsx("span", { className: "pando-agent-shell__loading-bubble pando-agent-shell__loading-bubble--4" }),
              /* @__PURE__ */ jsx("span", { className: "pando-agent-shell__loading-bubble pando-agent-shell__loading-bubble--5" }),
              /* @__PURE__ */ jsx("span", { className: "pando-agent-shell__loading-bubble pando-agent-shell__loading-bubble--6" })
            ]
          }
        ),
        /* @__PURE__ */ jsxs(
          "div",
          {
            className: "pando-agent-shell__loading-composer",
            "aria-hidden": "true",
            children: [
              /* @__PURE__ */ jsx("span", { className: "pando-agent-shell__loading-input" }),
              /* @__PURE__ */ jsx("span", { className: "pando-agent-shell__loading-action" })
            ]
          }
        )
      ]
    }
  );
}
function AgentPanel({ entryUrl, frame, title }) {
  return /* @__PURE__ */ jsxs("div", { className: "pando-agent-shell__panel-content", children: [
    frame.state.connection === "error" ? /* @__PURE__ */ jsx(
      StartupFailure,
      {
        message: frame.state.error,
        onRetry: frame.retry
      }
    ) : !frame.visible ? /* @__PURE__ */ jsx(StartupLoading, {}) : null,
    frame.mounted && /* @__PURE__ */ jsx(
      AgentFrame,
      {
        elementRef: frame.ref,
        entryUrl,
        title,
        visible: frame.visible
      }
    )
  ] });
}
const INITIAL_STATE = {
  ready: false,
  connection: "starting",
  activity: "idle"
};
const ENTRY_PROBE_RETRY_MS = 1e3;
const STARTUP_TIMEOUT_MS = 3e4;
function useAgentFrame(entryUrl) {
  const ref = useRef(null);
  const handshakeTimerRef = useRef();
  const reportedStateRef = useRef(false);
  const [probeCycle, setProbeCycle] = useState(0);
  const [mounted, setMounted] = useState(false);
  const [state, setState] = useState(INITIAL_STATE);
  useEffect(() => {
    reportedStateRef.current = false;
    setMounted(false);
    setState(INITIAL_STATE);
  }, [entryUrl]);
  useEffect(() => {
    let disposed = false;
    let retryTimer;
    let request;
    const probe = async () => {
      request = new AbortController();
      try {
        const response = await fetch(entryUrl, {
          method: "HEAD",
          redirect: "manual",
          cache: "no-store",
          signal: request.signal
        });
        if (disposed) {
          return;
        }
        if (isEntryReady(response)) {
          setMounted(true);
          return;
        }
      } catch {
        if (disposed) {
          return;
        }
      }
      retryTimer = setTimeout(() => {
        void probe();
      }, ENTRY_PROBE_RETRY_MS);
    };
    void probe();
    return () => {
      disposed = true;
      request == null ? void 0 : request.abort();
      if (retryTimer) {
        clearTimeout(retryTimer);
      }
    };
  }, [entryUrl, probeCycle]);
  useEffect(() => {
    if (mounted || state.connection !== "starting") {
      return;
    }
    const timer = setTimeout(() => {
      setState(startupFailure());
    }, STARTUP_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [mounted, probeCycle, state.connection]);
  useEffect(() => {
    if (!mounted || reportedStateRef.current) {
      return;
    }
    handshakeTimerRef.current = setTimeout(() => {
      handshakeTimerRef.current = void 0;
      if (reportedStateRef.current) {
        return;
      }
      setState(startupFailure());
      setMounted(false);
      setProbeCycle((value) => value + 1);
    }, STARTUP_TIMEOUT_MS);
    return () => {
      if (handshakeTimerRef.current) {
        clearTimeout(handshakeTimerRef.current);
        handshakeTimerRef.current = void 0;
      }
    };
  }, [mounted]);
  useEffect(() => {
    const receiveState = (event) => {
      var _a;
      if (event.source !== ((_a = ref.current) == null ? void 0 : _a.contentWindow) || !isAgentUiStateMessage(event.data)) {
        return;
      }
      reportedStateRef.current = true;
      if (handshakeTimerRef.current) {
        clearTimeout(handshakeTimerRef.current);
        handshakeTimerRef.current = void 0;
      }
      setState({
        ready: event.data.ready,
        connection: event.data.connection,
        activity: event.data.activity,
        ...event.data.error ? { error: event.data.error } : {}
      });
    };
    window.addEventListener("message", receiveState);
    return () => window.removeEventListener("message", receiveState);
  }, []);
  const retry = () => {
    reportedStateRef.current = false;
    setState(INITIAL_STATE);
    setMounted(false);
    setProbeCycle((value) => value + 1);
  };
  return {
    ref,
    mounted,
    retry,
    state,
    visible: state.ready
  };
}
function isEntryReady(response) {
  return response.type === "opaqueredirect" || response.status >= 300 && response.status < 400;
}
function startupFailure() {
  return {
    ready: false,
    connection: "error",
    activity: "idle",
    error: "智能向导页面未能完成加载，请重试。"
  };
}
function isAgentUiStateMessage(value) {
  if (!value || typeof value !== "object") {
    return false;
  }
  const message = value;
  return message.type === "pando-agent/state" && message.version === 1 && typeof message.ready === "boolean" && (message.connection === "connecting" || message.connection === "online" || message.connection === "error") && (message.activity === "idle" || message.activity === "working") && (message.error === void 0 || typeof message.error === "string");
}
const ELEMENT_WAIT_MS$2 = 1e4;
function navigateToGuidePage(page) {
  const route = `/${page}`;
  if (window.location.hash.replace(/^#/, "") !== route) {
    window.location.hash = route;
  }
}
async function activateGuideElement(key) {
  const element = await waitForGuideElement(key);
  element.click();
}
function getGuideSelector(key) {
  return `[data-guide="${key}"]`;
}
function waitForGuideElement(key, timeoutMs = ELEMENT_WAIT_MS$2) {
  const selector = getGuideSelector(key);
  const existing = document.querySelector(selector);
  if (existing) {
    return Promise.resolve(existing);
  }
  return new Promise((resolve, reject) => {
    const observer = new MutationObserver(() => {
      const element = document.querySelector(selector);
      if (!element) {
        return;
      }
      window.clearTimeout(timeout);
      observer.disconnect();
      resolve(element);
    });
    const timeout = window.setTimeout(() => {
      observer.disconnect();
      reject(new Error(`Guide target did not appear: ${key}`));
    }, timeoutMs);
    observer.observe(document.body, { childList: true, subtree: true });
  });
}
const e = [`pointerdown`, `mousedown`, `pointerup`, `mouseup`, `click`], t = /* @__PURE__ */ new WeakMap();
function n(n2, i2, a2) {
  r(n2);
  let o2 = (e2) => {
    let t2 = e2.target;
    n2.contains(t2) && ((!a2 || a2(t2)) && (e2.preventDefault(), e2.stopPropagation(), e2.stopImmediatePropagation()), e2.type === `click` && (i2 == null ? void 0 : i2(e2)));
  };
  for (let t2 of e) document.addEventListener(t2, o2, true);
  t.set(n2, o2);
}
function r(n2) {
  let r2 = t.get(n2);
  if (r2) {
    for (let t2 of e) document.removeEventListener(t2, r2, true);
    t.delete(n2);
  }
}
function i(e2, t2) {
  let n2 = e2.wrapper.getBoundingClientRect();
  return { width: n2.width + t2, height: n2.height + t2, realWidth: n2.width, realHeight: n2.height };
}
function a(e2, t2) {
  let { elementDimensions: n2, popoverDimensions: r2, popoverPadding: i2, popoverArrowDimensions: a2 } = t2;
  return e2 === `start` ? Math.max(Math.min(n2.top - i2, window.innerHeight - r2.realHeight - a2.width), a2.width) : e2 === `end` ? Math.max(Math.min(n2.top - (r2 == null ? void 0 : r2.realHeight) + n2.height + i2, window.innerHeight - (r2 == null ? void 0 : r2.realHeight) - a2.width), a2.width) : e2 === `center` ? Math.max(Math.min(n2.top + n2.height / 2 - (r2 == null ? void 0 : r2.realHeight) / 2, window.innerHeight - (r2 == null ? void 0 : r2.realHeight) - a2.width), a2.width) : 0;
}
function o(e2, t2) {
  let { elementDimensions: n2, popoverDimensions: r2, popoverPadding: i2, popoverArrowDimensions: a2 } = t2;
  return e2 === `start` ? Math.max(Math.min(n2.left - i2, window.innerWidth - r2.realWidth - a2.width), a2.width) : e2 === `end` ? Math.max(Math.min(n2.left - (r2 == null ? void 0 : r2.realWidth) + n2.width + i2, window.innerWidth - (r2 == null ? void 0 : r2.realWidth) - a2.width), a2.width) : e2 === `center` ? Math.max(Math.min(n2.left + n2.width / 2 - (r2 == null ? void 0 : r2.realWidth) / 2, window.innerWidth - (r2 == null ? void 0 : r2.realWidth) - a2.width), a2.width) : 0;
}
function s(e2, t2, n2) {
  let { align: r2, side: s2 } = n2, c2 = n2.centered ? `over` : s2, l2 = n2.padding, u2 = i(e2, n2.offset), f2 = e2.arrow.getBoundingClientRect(), p2 = t2.getBoundingClientRect(), m2 = p2.top - u2.height, h2 = m2 >= 0, g2 = window.innerHeight - (p2.bottom + u2.height), _2 = g2 >= 0, v2 = p2.left - u2.width, y2 = v2 >= 0, b2 = window.innerWidth - (p2.right + u2.width), x2 = b2 >= 0, S2 = !h2 && !_2 && !y2 && !x2, C2 = c2;
  if (c2 === `top` && h2 ? x2 = y2 = _2 = false : c2 === `bottom` && _2 ? x2 = y2 = h2 = false : c2 === `left` && y2 ? x2 = h2 = _2 = false : c2 === `right` && x2 && (y2 = h2 = _2 = false), c2 === `over`) {
    let t3 = window.innerWidth / 2 - u2.realWidth / 2, n3 = window.innerHeight / 2 - u2.realHeight / 2;
    e2.wrapper.style.left = `${t3}px`, e2.wrapper.style.right = `auto`, e2.wrapper.style.top = `${n3}px`, e2.wrapper.style.bottom = `auto`;
  } else if (S2) {
    let t3 = window.innerWidth / 2 - (u2 == null ? void 0 : u2.realWidth) / 2;
    e2.wrapper.style.left = `${t3}px`, e2.wrapper.style.right = `auto`, e2.wrapper.style.bottom = `10px`, e2.wrapper.style.top = `auto`;
  } else if (y2) {
    let t3 = Math.min(v2, window.innerWidth - (u2 == null ? void 0 : u2.realWidth) - f2.width), n3 = a(r2, { elementDimensions: p2, popoverDimensions: u2, popoverPadding: l2, popoverArrowDimensions: f2 });
    e2.wrapper.style.left = `${t3}px`, e2.wrapper.style.top = `${n3}px`, e2.wrapper.style.bottom = `auto`, e2.wrapper.style.right = `auto`, C2 = `left`;
  } else if (x2) {
    let t3 = Math.min(b2, window.innerWidth - (u2 == null ? void 0 : u2.realWidth) - f2.width), n3 = a(r2, { elementDimensions: p2, popoverDimensions: u2, popoverPadding: l2, popoverArrowDimensions: f2 });
    e2.wrapper.style.right = `${t3}px`, e2.wrapper.style.top = `${n3}px`, e2.wrapper.style.bottom = `auto`, e2.wrapper.style.left = `auto`, C2 = `right`;
  } else if (h2) {
    let t3 = Math.min(m2, window.innerHeight - u2.realHeight - f2.width), n3 = o(r2, { elementDimensions: p2, popoverDimensions: u2, popoverPadding: l2, popoverArrowDimensions: f2 });
    e2.wrapper.style.top = `${t3}px`, e2.wrapper.style.left = `${n3}px`, e2.wrapper.style.bottom = `auto`, e2.wrapper.style.right = `auto`, C2 = `top`;
  } else if (_2) {
    let t3 = Math.min(g2, window.innerHeight - (u2 == null ? void 0 : u2.realHeight) - f2.width), n3 = o(r2, { elementDimensions: p2, popoverDimensions: u2, popoverPadding: l2, popoverArrowDimensions: f2 });
    e2.wrapper.style.left = `${n3}px`, e2.wrapper.style.bottom = `${t3}px`, e2.wrapper.style.top = `auto`, e2.wrapper.style.right = `auto`, C2 = `bottom`;
  }
  d(e2, S2 ? `over` : C2, r2, t2), [...e2.wrapper.classList].filter((e3) => e3.startsWith(`driver-popover-side-`) || e3.startsWith(`driver-popover-align-`)).forEach((t3) => e2.wrapper.classList.remove(t3)), e2.wrapper.classList.add(`driver-popover-side-${C2}`), e2.wrapper.classList.add(`driver-popover-align-${r2}`);
}
function c(e2, t2, n2, r2, i2, a2 = 10) {
  let o2 = r2 - n2;
  return e2 <= n2 && t2 >= r2 ? i2 === `start` ? 15 + a2 / 2 : i2 === `end` ? o2 - 15 - a2 / 2 : o2 / 2 : (Math.min(Math.max(e2, n2), r2) + Math.min(Math.max(t2, n2), r2)) / 2 - n2;
}
function l(e2, t2, n2 = 10) {
  let r2 = t2 - 15 - n2;
  if (r2 < 15) return Math.max(0, (t2 - n2) / 2);
  let i2 = e2 - n2 / 2;
  return Math.min(Math.max(i2, 15), r2);
}
function u(e2, t2, n2) {
  return e2 === `left` || e2 === `right` ? t2.bottom > n2.top && t2.top < n2.bottom ? e2 : t2.bottom <= n2.top ? `bottom` : `top` : t2.right > n2.left && t2.left < n2.right ? e2 : t2.right <= n2.left ? `right` : `left`;
}
function d(e2, t2, n2, r2) {
  let i2 = e2.arrow;
  if (i2.className = `driver-popover-arrow`, i2.style.top = ``, i2.style.right = ``, i2.style.bottom = ``, i2.style.left = ``, t2 === `over`) {
    i2.classList.add(`driver-popover-arrow-none`);
    return;
  }
  let a2 = r2.getBoundingClientRect(), o2 = e2.wrapper.getBoundingClientRect(), s2 = u(t2, a2, o2);
  i2.classList.add(`driver-popover-arrow-side-${s2}`);
  let d2 = i2.getBoundingClientRect().width || 10;
  if (s2 === `left` || s2 === `right`) {
    let e3 = c(a2.top, a2.bottom, o2.top, o2.bottom, n2, d2);
    i2.style.top = `${l(e3, o2.height, d2)}px`;
  } else {
    let e3 = c(a2.left, a2.right, o2.left, o2.right, n2, d2);
    i2.style.left = `${l(e3, o2.width, d2)}px`;
  }
}
function f(e2) {
  return typeof e2 == `function` ? e2() : typeof e2 == `string` ? document.querySelector(e2) : e2;
}
function p(e2) {
  return !e2 || e2.id === `driver-dummy-element`;
}
function m(e2) {
  let t2 = window.getComputedStyle(e2);
  return [t2.overflow, t2.overflowX, t2.overflowY].some((e3) => e3 === `auto` || e3 === `scroll`);
}
function h(e2, t2, n2, r2) {
  return (e2 /= r2 / 2) < 1 ? n2 / 2 * e2 * e2 + t2 : -n2 / 2 * (--e2 * (e2 - 2) - 1) + t2;
}
function g(e2) {
  let t2 = [`a[href]`, `area[href]`, `button:not([disabled])`, `input:not([disabled]):not([type="hidden"])`, `select:not([disabled])`, `textarea:not([disabled])`, `summary`, `audio[controls]`, `video[controls]`, `[contenteditable]:not([contenteditable="false"])`, `[tabindex]:not([tabindex="-1"]):not([disabled])`].join(`, `);
  return e2.flatMap((e3) => {
    let n2 = e3.matches(t2), r2 = Array.from(e3.querySelectorAll(t2));
    return [...n2 ? [e3] : [], ...r2];
  }).filter((e3) => getComputedStyle(e3).pointerEvents !== `none` && x(e3));
}
function _(e2, t2) {
  if (!e2 || y(e2)) return;
  let n2 = e2.offsetHeight > window.innerHeight;
  e2.scrollIntoView({ behavior: !t2 || v(e2) ? `auto` : `smooth`, inline: `center`, block: n2 ? `start` : `center` });
}
function v(e2) {
  if (!e2 || !e2.parentElement) return;
  let t2 = e2.parentElement;
  return t2.scrollHeight > t2.clientHeight;
}
function y(e2) {
  let t2 = e2.getBoundingClientRect();
  return t2.top >= 0 && t2.left >= 0 && t2.bottom <= (window.innerHeight || document.documentElement.clientHeight) && t2.right <= (window.innerWidth || document.documentElement.clientWidth) && !b(e2, t2);
}
function b(e2, t2) {
  let n2 = e2;
  for (; n2; ) {
    if (getComputedStyle(n2).position === `fixed`) return false;
    let e3 = n2.parentElement;
    if (!e3 || e3 === document.body || e3 === document.documentElement) return false;
    if (m(e3)) {
      let n3 = e3.getBoundingClientRect(), r2 = n3.top + e3.clientTop, i2 = n3.left + e3.clientLeft;
      if (t2.top < r2 || t2.left < i2 || t2.bottom > r2 + (e3.clientHeight || n3.height) || t2.right > i2 + (e3.clientWidth || n3.width)) return true;
    }
    n2 = e3;
  }
  return false;
}
function x(e2) {
  return !!(e2.offsetWidth || e2.offsetHeight || e2.getClientRects().length);
}
const S = /* @__PURE__ */ new WeakSet();
function C(e2) {
  let t2 = e2.closest(`dialog[open]`);
  if (!t2) return document.body;
  if (!(`showPopover` in t2)) return t2;
  let n2 = t2.querySelector(`:scope > .driver-layer`);
  return n2 || (n2 = document.createElement(`div`), n2.className = `driver-layer`, n2.setAttribute(`popover`, `manual`), t2.appendChild(n2)), S.has(t2) || (S.add(t2), t2.addEventListener(`close`, () => {
    var _a;
    (_a = t2.querySelector(`:scope > .driver-layer:popover-open`)) == null ? void 0 : _a.hidePopover();
  })), n2.matches(`:popover-open`) || n2.showPopover(), n2;
}
function ee(e2) {
  let t2 = e2.parentElement;
  e2.remove(), (t2 == null ? void 0 : t2.classList.contains(`driver-layer`)) && !t2.childElementCount && t2.remove();
}
const te = [`input`, `textarea`, `select`, `[role=combobox]`, `[role=grid]`, `[role=listbox]`, `[role=menu]`, `[role=menubar]`, `[role=radiogroup]`, `[role=slider]`, `[role=spinbutton]`, `[role=tablist]`, `[role=textbox]`, `[role=tree]`, `[role=treegrid]`].join(`, `);
function ne(e2) {
  return e2 instanceof HTMLElement ? e2.isContentEditable || !!e2.closest(te) : false;
}
function w(e2) {
  e2 && (e2.wrapper.style.display = `none`);
}
const T = /* @__PURE__ */ new WeakMap(), E = /* @__PURE__ */ new WeakMap();
function D(e2, t2) {
  E.get(e2) !== t2 && (e2.innerHTML = t2, E.set(e2, t2));
}
function O(e2, t2, n2 = `block`) {
  e2.style.display = t2 ? n2 : `none`;
}
function k(e2, t2) {
  e2.disabled = t2, e2.classList.toggle(`driver-popover-btn-disabled`, t2);
}
function A(e2, t2) {
  let { title: n2, description: r2, showButtons: i2, disableButtons: a2, showProgress: o2, nextBtnText: s2, prevBtnText: c2, progressText: l2 } = t2;
  D(e2.nextButton, s2), D(e2.previousButton, c2), D(e2.progress, l2), e2.closeButton.setAttribute(`aria-label`, t2.closeBtnLabel), e2.nextButton.classList.toggle(`driver-popover-done-btn`, !!t2.doneButton), n2 && D(e2.title, n2), O(e2.title, !!n2), r2 && D(e2.description, r2), O(e2.description, !!r2);
  let u2 = i2.includes(`next`) || i2.includes(`previous`) || o2;
  O(e2.closeButton, i2.includes(`close`)), O(e2.footer, u2, `flex`), O(e2.progress, o2), O(e2.nextButton, i2.includes(`next`)), O(e2.previousButton, i2.includes(`previous`)), k(e2.nextButton, a2.includes(`next`)), k(e2.previousButton, a2.includes(`previous`)), k(e2.closeButton, a2.includes(`close`));
  let d2 = e2.wrapper;
  d2.classList.remove(...T.get(d2) || []);
  let f2 = (t2.popoverClass || ``).split(/\s+/).filter(Boolean);
  d2.classList.add(...f2), T.set(d2, f2);
}
function re(e2, t2) {
  var _a;
  if (e2.disabled) return true;
  for (let n2 = e2; n2 && n2 !== t2; n2 = n2.parentElement) if (((_a = n2.style) == null ? void 0 : _a.display) === `none`) return true;
  return false;
}
function j(e2, t2, n2) {
  let r2 = document.activeElement, i2 = !!r2 && e2.wrapper.contains(r2) && r2 !== e2.wrapper;
  A(e2, n2), i2 && (!r2.isConnected || re(r2, e2.wrapper)) && (e2.wrapper.setAttribute(`tabindex`, `-1`), e2.wrapper.focus()), s(e2, t2, n2.position), N(e2, t2, n2.position);
}
function M(e2, t2) {
  var _a;
  let r2 = P();
  C(e2).appendChild(r2.wrapper);
  let i2 = r2.wrapper;
  i2.className = `driver-popover`, A(r2, t2), i2.style.display = `block`, i2.style.left = ``, i2.style.top = ``, i2.style.bottom = ``, i2.style.right = ``, i2.id = `driver-popover-content`, i2.setAttribute(`role`, `dialog`), i2.setAttribute(`aria-labelledby`, `driver-popover-title`), i2.setAttribute(`aria-describedby`, `driver-popover-description`), r2.arrow.className = `driver-popover-arrow`, n(r2.wrapper, (e3) => {
    var _a2, _b, _c, _d;
    let n2 = e3.target instanceof Element ? e3.target : (_a2 = e3.target) == null ? void 0 : _a2.parentElement;
    if (n2) {
      if (n2.closest(`.driver-popover-next-btn`)) return (_b = t2.onNextClick) == null ? void 0 : _b.call(t2);
      if (n2.closest(`.driver-popover-prev-btn`)) return (_c = t2.onPrevClick) == null ? void 0 : _c.call(t2);
      if (n2.closest(`.driver-popover-close-btn`)) return (_d = t2.onCloseClick) == null ? void 0 : _d.call(t2);
    }
  }, (e3) => r2.description.contains(e3) || r2.title.contains(e3) ? false : !!e3.closest(`.driver-popover-prev-btn, .driver-popover-next-btn, .driver-popover-close-btn`)), (_a = t2.onRender) == null ? void 0 : _a.call(t2, r2), s(r2, e2, t2.position), N(r2, e2, t2.position), _(i2, t2.smoothScroll);
  let a2 = t2.keepFocus ? [] : g([i2, e2]);
  return a2.length > 0 && a2[0].focus(), r2;
}
function N(e2, t2, n2) {
  e2.wrapper.querySelectorAll(`img`).forEach((r2) => {
    if (r2.complete) return;
    let i2 = () => s(e2, t2, n2);
    r2.addEventListener(`load`, i2, { once: true }), r2.addEventListener(`error`, i2, { once: true });
  });
}
function P() {
  let e2 = document.createElement(`div`);
  e2.classList.add(`driver-popover`);
  let t2 = document.createElement(`div`);
  t2.classList.add(`driver-popover-arrow`);
  let n2 = document.createElement(`div`);
  n2.id = `driver-popover-title`, n2.classList.add(`driver-popover-title`), n2.style.display = `none`, n2.innerText = `Popover Title`;
  let r2 = document.createElement(`div`);
  r2.id = `driver-popover-description`, r2.classList.add(`driver-popover-description`), r2.style.display = `none`, r2.innerText = `Popover description is here`;
  let i2 = document.createElement(`button`);
  i2.type = `button`, i2.classList.add(`driver-popover-close-btn`), i2.innerHTML = `&times;`;
  let a2 = document.createElement(`div`);
  a2.classList.add(`driver-popover-footer`);
  let o2 = document.createElement(`span`);
  o2.classList.add(`driver-popover-progress-text`), o2.innerText = ``;
  let s2 = document.createElement(`span`);
  s2.classList.add(`driver-popover-navigation-btns`);
  let c2 = document.createElement(`button`);
  c2.type = `button`, c2.classList.add(`driver-popover-prev-btn`, `driver-popover-footer-btn`), c2.innerHTML = `Previous`;
  let l2 = document.createElement(`button`);
  return l2.type = `button`, l2.classList.add(`driver-popover-next-btn`, `driver-popover-footer-btn`), l2.innerHTML = `Next`, s2.appendChild(c2), s2.appendChild(l2), a2.appendChild(o2), a2.appendChild(s2), e2.appendChild(i2), e2.appendChild(t2), e2.appendChild(n2), e2.appendChild(r2), e2.appendChild(a2), { wrapper: e2, arrow: t2, title: n2, description: r2, footer: a2, previousButton: c2, nextButton: l2, closeButton: i2, footerButtons: s2, progress: o2 };
}
function F(e2) {
  e2 && (r(e2.wrapper), ee(e2.wrapper));
}
function I(e2, t2) {
  let n2 = window.innerWidth, r2 = window.innerHeight, i2 = t2.padding, a2 = t2.radius, o2 = e2.width + i2 * 2, s2 = e2.height + i2 * 2, c2 = Math.min(a2, o2 / 2, s2 / 2), l2 = Math.floor(Math.max(c2, 0)), u2 = e2.x - i2 + l2, d2 = e2.y - i2, f2 = o2 - l2 * 2, p2 = s2 - l2 * 2;
  return `M${n2},0L0,0L0,${r2}L${n2},${r2}L${n2},0Z
    M${u2},${d2} h${f2} a${l2},${l2} 0 0 1 ${l2},${l2} v${p2} a${l2},${l2} 0 0 1 -${l2},${l2} h-${f2} a${l2},${l2} 0 0 1 -${l2},-${l2} v-${p2} a${l2},${l2} 0 0 1 ${l2},-${l2} z`;
}
function ie(e2, t2, n2, r2, i2) {
  let a2 = e2.getState(`__activeStagePosition`), o2 = a2 || r2.getBoundingClientRect(), s2 = i2.getBoundingClientRect();
  a2 = { x: h(t2, o2.x, s2.x - o2.x, n2), y: h(t2, o2.y, s2.y - o2.y, n2), width: h(t2, o2.width, s2.width - o2.width, n2), height: h(t2, o2.height, s2.height - o2.height, n2) }, se(e2, a2), e2.setState(`__activeStagePosition`, a2);
}
function L(e2, t2) {
  if (!t2) return;
  let n2 = t2.getBoundingClientRect(), r2 = { x: n2.x, y: n2.y, width: n2.width, height: n2.height };
  e2.setState(`__activeStagePosition`, r2), se(e2, r2);
}
function ae(e2) {
  let t2 = e2.getState(`__activeStagePosition`), n2 = e2.getState(`__overlaySvg`);
  if (!t2) return;
  if (!n2) {
    console.warn(`No stage svg found.`);
    return;
  }
  let r2 = window.innerWidth, i2 = window.innerHeight;
  n2.setAttribute(`viewBox`, `0 0 ${r2} ${i2}`);
}
function oe(e2, t2) {
  let r2 = le(e2, t2);
  document.body.appendChild(r2), n(r2, (t3) => {
    t3.target.tagName === `path` && e2.emit(`overlayClick`);
  }), e2.setState(`__overlaySvg`, r2);
}
function se(e2, t2) {
  let n2 = e2.getState(`__overlaySvg`);
  if (!n2) {
    oe(e2, t2);
    return;
  }
  let r2 = n2.firstElementChild;
  if ((r2 == null ? void 0 : r2.tagName) !== `path`) throw Error(`no path element found in stage svg`);
  r2.setAttribute(`d`, I(t2, ce(e2)));
}
function ce(e2) {
  var _a;
  return ((_a = e2.getState(`activeElement`)) == null ? void 0 : _a.id) === `driver-dummy-element` ? { padding: 0, radius: 0 } : { padding: e2.getConfig(`stagePadding`) || 0, radius: e2.getConfig(`stageRadius`) || 0 };
}
function le(e2, t2) {
  let n2 = window.innerWidth, r2 = window.innerHeight, i2 = document.createElementNS(`http://www.w3.org/2000/svg`, `svg`);
  i2.classList.add(`driver-overlay`, `driver-overlay-animated`), i2.setAttribute(`viewBox`, `0 0 ${n2} ${r2}`), i2.setAttribute(`xmlSpace`, `preserve`), i2.setAttribute(`xmlnsXlink`, `http://www.w3.org/1999/xlink`), i2.setAttribute(`version`, `1.1`), i2.setAttribute(`preserveAspectRatio`, `xMinYMin slice`), i2.style.fillRule = `evenodd`, i2.style.clipRule = `evenodd`, i2.style.strokeLinejoin = `round`, i2.style.strokeMiterlimit = `2`, i2.style.zIndex = `10000`, i2.style.position = `fixed`, i2.style.top = `0`, i2.style.left = `0`, i2.style.width = `100%`, i2.style.height = `100%`;
  let a2 = document.createElementNS(`http://www.w3.org/2000/svg`, `path`);
  return a2.setAttribute(`d`, I(t2, ce(e2))), a2.style.fill = e2.getConfig(`overlayColor`) || `rgb(0,0,0)`, a2.style.opacity = `${e2.getConfig(`overlayOpacity`)}`, a2.style.pointerEvents = `auto`, a2.style.cursor = `auto`, i2.appendChild(a2), i2;
}
function ue(e2) {
  let t2 = e2.getState(`__overlaySvg`);
  t2 && (r(t2), t2.remove());
}
const R = `driver-allowed-element`;
function de(e2, t2) {
  return t2.allowedElements ?? e2.getConfig(`allowedElements`);
}
function fe(e2) {
  return e2 ? typeof e2 == `function` ? Array.from(e2() || []) : (Array.isArray(e2) ? e2 : [e2]).flatMap((e3) => typeof e3 == `string` ? Array.from(document.querySelectorAll(e3)) : e3 ? [e3] : []) : [];
}
function pe(e2, t2, n2) {
  let r2 = de(e2, t2);
  if (!r2) return;
  let i2 = /* @__PURE__ */ new Set(), a2, o2 = () => {
    if (n2.aborted) return;
    let e3 = new Set(fe(r2));
    i2.forEach((t3) => {
      !e3.has(t3) && t3.classList.contains(`driver-allowed-element`) && t3.classList.remove(R);
    }), e3.forEach((e4) => {
      e4.classList.contains(`driver-allowed-element`) || e4.classList.add(R);
    }), i2 = e3;
  }, s2 = new MutationObserver(() => {
    a2 === void 0 && (a2 = window.requestAnimationFrame(() => {
      a2 = void 0, o2();
    }));
  });
  o2(), s2.observe(document.body, { childList: true, subtree: true, attributes: true }), e2.setState(`__syncAllowedElements`, o2), n2.addEventListener(`abort`, () => {
    s2.disconnect(), a2 !== void 0 && window.cancelAnimationFrame(a2), i2.forEach((e3) => e3.classList.remove(R)), e2.getState(`__syncAllowedElements`) === o2 && e2.setState(`__syncAllowedElements`, void 0);
  });
}
function me(e2, t2, n2) {
  let r2 = document.activeElement;
  if (!r2 || r2 === document.body) return false;
  let i2 = !(n2.disableActiveInteraction ?? e2.getConfig(`disableActiveInteraction`));
  return !p(t2) && i2 && t2.contains(r2) ? true : fe(de(e2, n2)).some((e3) => e3.contains(r2));
}
function he(e2) {
  if (e2.getState(`__liveRegion`)) return;
  let t2 = document.createElement(`div`);
  t2.className = `driver-live-region`, t2.setAttribute(`aria-live`, `polite`), t2.setAttribute(`aria-atomic`, `true`), Object.assign(t2.style, { position: `absolute`, width: `1px`, height: `1px`, margin: `-1px`, padding: `0`, overflow: `hidden`, clip: `rect(0 0 0 0)`, clipPath: `inset(50%)`, whiteSpace: `nowrap`, border: `0` }), document.body.appendChild(t2), e2.setState(`__liveRegion`, t2);
}
function ge(e2, t2) {
  let n2 = e2.getState(`__liveRegion`), r2 = t2.trim();
  !n2 || !r2 || e2.getState(`__lastAnnouncement`) === r2 || (e2.setState(`__lastAnnouncement`, r2), n2.textContent = r2);
}
function _e(e2) {
  var _a;
  (_a = e2.getState(`__liveRegion`)) == null ? void 0 : _a.remove();
}
const ve = `{{current}} of {{total}}`;
function ye(e2, t2) {
  return !(t2.skipMissingElement ?? e2.getConfig(`skipMissingElement`)) || !t2.element ? false : !f(t2.element);
}
function z(e2, t2, n2) {
  let r2 = e2.getConfig(`steps`) || [];
  for (let i2 = t2; i2 >= 0 && i2 < r2.length; i2 += n2) if (!ye(e2, r2[i2])) return i2;
}
function B(e2, t2) {
  let n2 = e2.getState(`activeIndex`);
  return n2 !== void 0 && z(e2, n2 + t2, t2) === void 0;
}
function be(e2, t2) {
  var _a, _b;
  let n2 = B(e2, 1), r2 = ((_a = t2 == null ? void 0 : t2.popover) == null ? void 0 : _a.onDoneClick) || e2.getConfig(`onDoneClick`);
  return n2 && r2 ? r2 : ((_b = t2 == null ? void 0 : t2.popover) == null ? void 0 : _b.onNextClick) || e2.getConfig(`onNextClick`);
}
function V(e2, t2) {
  var _a;
  return ((_a = t2 == null ? void 0 : t2.popover) == null ? void 0 : _a.onPrevClick) || e2.getConfig(`onPrevClick`);
}
function xe(e2, t2) {
  var _a;
  return ((_a = t2 == null ? void 0 : t2.popover) == null ? void 0 : _a.onCloseClick) || e2.getConfig(`onCloseClick`);
}
function Se(e2, t2, n2) {
  let r2 = (e2.getConfig(`steps`) || []).length;
  return t2.replace(`{{current}}`, `${n2 + 1}`).replace(`{{total}}`, `${r2}`);
}
function Ce(e2, t2, n2) {
  let r2 = (e2.getConfig(`steps`) || [])[t2], i2 = r2.popover || {}, a2 = z(e2, t2 + 1, 1) !== void 0, o2 = z(e2, t2 - 1, -1) !== void 0, s2 = i2.doneBtnText || e2.getConfig(`doneBtnText`) || `Done`, c2 = e2.getConfig(`allowClose`), l2 = i2.showProgress === void 0 ? e2.getConfig(`showProgress`) : i2.showProgress, u2 = i2.progressText || e2.getConfig(`progressText`) || ve, d2 = i2.showButtons || e2.getConfig(`showButtons`), f2 = [`next`, `previous`, ...c2 ? [`close`] : []].filter((e3) => !d2 || d2.includes(e3));
  return { ...r2, popover: { showButtons: f2, nextBtnText: a2 ? void 0 : s2, disableButtons: [...e2.getConfig(`disableButtons`) || [], ...o2 ? [] : [`previous`]], showProgress: l2, onNextClick: i2.onNextClick || e2.getConfig(`onNextClick`) || n2.onNextClick, onPrevClick: V(e2, r2) || n2.onPrevClick, onCloseClick: xe(e2, r2) || n2.onCloseClick, ...i2, progressText: Se(e2, u2, t2) } };
}
function we(e2, t2) {
  var _a, _b;
  return { showButtons: ((_a = t2 == null ? void 0 : t2.popover) == null ? void 0 : _a.showButtons) || e2.getConfig(`showButtons`) || [], disableButtons: ((_b = t2 == null ? void 0 : t2.popover) == null ? void 0 : _b.disableButtons) || e2.getConfig(`disableButtons`) || [] };
}
function Te(e2) {
  var _a;
  return !!e2.getState(`__isWaiting`) || !!((_a = e2.getState(`popover`)) == null ? void 0 : _a.wrapper.classList.contains(`driver-popover-waiting`));
}
function Ee(e2, t2, n2) {
  var _a, _b;
  let r2 = e2.getConfig(`stagePadding`) || 0;
  return { side: ((_a = n2.popover) == null ? void 0 : _a.side) || `bottom`, align: ((_b = n2.popover) == null ? void 0 : _b.align) || `start`, offset: r2 + (e2.getConfig(`popoverOffset`) || 0), padding: r2, centered: t2.id === `driver-dummy-element` };
}
function De(e2, t2, n2) {
  let r2 = n2.popover || {}, i2 = B(e2, 1);
  return { title: r2.title, description: r2.description, ...we(e2, n2), showProgress: r2.showProgress || e2.getConfig(`showProgress`) || false, progressText: r2.progressText ?? (e2.getConfig(`progressText`) || ve), nextBtnText: r2.nextBtnText ?? (e2.getConfig(`nextBtnText`) || `Next`), prevBtnText: r2.prevBtnText ?? (e2.getConfig(`prevBtnText`) || `Previous`), closeBtnLabel: r2.closeBtnLabel ?? (e2.getConfig(`closeBtnLabel`) || `Close`), doneButton: i2, popoverClass: r2.popoverClass || e2.getConfig(`popoverClass`) || ``, smoothScroll: e2.getConfig(`smoothScroll`), onNextClick: () => {
    i2 && e2.setState(`__destroyReason`, `done`);
    let r3 = be(e2, n2);
    return r3 ? r3(e2.getState(`activeElement`) ?? t2, n2, e2.getHookOpts()) : e2.emit(`nextClick`);
  }, onPrevClick: () => {
    let r3 = V(e2, n2);
    return r3 ? r3(e2.getState(`activeElement`) ?? t2, n2, e2.getHookOpts()) : e2.emit(`prevClick`);
  }, onCloseClick: () => {
    e2.setState(`__destroyReason`, `close`);
    let r3 = xe(e2, n2);
    return r3 ? r3(e2.getState(`activeElement`) ?? t2, n2, e2.getHookOpts()) : e2.emit(`closeClick`);
  }, onRender: (t3) => {
    var _a;
    e2.setState(`popover`, t3), (_a = r2.onPopoverRender || e2.getConfig(`onPopoverRender`)) == null ? void 0 : _a(t3, e2.getHookOpts());
  }, position: Ee(e2, t2, n2) };
}
function Oe(e2, t2) {
  let n2 = e2.getState(`__activation`);
  return (n2 == null ? void 0 : n2.popoverPatch) && n2.step === t2 ? n2.popoverPatch : void 0;
}
function ke(e2, t2) {
  let n2 = Oe(e2, t2);
  return n2 ? { ...t2, popover: { ...t2.popover, ...n2 } } : t2;
}
function Ae(e2, t2, n2) {
  let r2 = De(e2, t2, ke(e2, n2)), i2 = Oe(e2, n2);
  return i2 ? (i2.showProgress !== void 0 && (r2.showProgress = i2.showProgress), i2.popoverClass !== void 0 && (r2.popoverClass = i2.popoverClass), i2.progressText !== void 0 && (r2.progressText = Se(e2, i2.progressText, e2.getState(`activeIndex`) ?? 0)), r2) : r2;
}
function H(e2, t2, n2) {
  F(e2.getState(`popover`));
  let r2 = me(e2, t2, n2), i2 = M(t2, { ...Ae(e2, t2, n2), keepFocus: r2 });
  e2.getState(`__isWaiting`) && W(e2), r2 && ge(e2, U(i2).filter(Boolean).join(`. `));
}
function U(e2) {
  return [e2.title, e2.description].map((e3) => e3.style.display === `none` ? `` : e3.textContent || ``);
}
function je(e2, t2, n2) {
  let r2 = e2.getState(`popover`);
  r2 && j(r2, t2, Ae(e2, t2, n2));
}
function Me(e2, t2, n2) {
  let r2 = e2.getState(`popover`);
  r2 && s(r2, t2, Ee(e2, t2, n2));
}
function W(e2) {
  e2.setState(`__isWaiting`, true);
  let t2 = e2.getState(`popover`);
  !t2 || t2.wrapper.style.display === `none` || (t2.wrapper.classList.add(`driver-popover-waiting`), t2.wrapper.setAttribute(`aria-busy`, `true`), k(t2.nextButton, true), k(t2.previousButton, true));
}
function Ne(e2, t2, n2) {
  e2.setState(`__isWaiting`, false);
  let r2 = e2.getState(`popover`);
  !r2 || !r2.wrapper.classList.contains(`driver-popover-waiting`) || (r2.wrapper.classList.remove(`driver-popover-waiting`), r2.wrapper.removeAttribute(`aria-busy`), t2 && n2 && je(e2, t2, n2));
}
const G = { "aria-haspopup": `dialog`, "aria-expanded": `true`, "aria-controls": `driver-popover-content` }, K = /* @__PURE__ */ new WeakSet();
function Pe(e2) {
  if (!(Object.keys(G).some((t2) => e2.hasAttribute(t2)) && !K.has(e2))) {
    for (let [t2, n2] of Object.entries(G)) e2.setAttribute(t2, n2);
    K.add(e2);
  }
}
function Fe(e2) {
  if (K.has(e2)) {
    for (let [t2, n2] of Object.entries(G)) e2.getAttribute(t2) === n2 && e2.removeAttribute(t2);
    K.delete(e2);
  }
}
function Ie() {
  let e2 = document.getElementById(`driver-dummy-element`);
  if (e2) return e2;
  let t2 = document.createElement(`div`);
  return t2.id = `driver-dummy-element`, t2.style.width = `0`, t2.style.height = `0`, t2.style.pointerEvents = `none`, t2.style.opacity = `0`, t2.style.position = `fixed`, t2.style.top = `50%`, t2.style.left = `50%`, document.body.appendChild(t2), t2;
}
function Le(e2, t2) {
  let n2 = f(t2.element);
  n2 || (n2 = Ie()), ze(e2, n2, t2);
}
function Re(e2) {
  var _a;
  let t2 = e2.getState(`__activeElement`), n2 = e2.getState(`__activeStep`);
  t2 && (L(e2, t2), ae(e2), (_a = e2.getState(`__syncAllowedElements`)) == null ? void 0 : _a(), Me(e2, t2, n2));
}
function ze(e2, t2, n2) {
  let r2 = e2.getConfig(`duration`) || 400, i2 = Date.now(), a2 = e2.getState(`__activeStep`), o2 = e2.getState(`__activeElement`) || t2, s2 = !o2 || o2 === t2, c2 = t2.id === `driver-dummy-element`, l2 = o2.id === `driver-dummy-element`, u2 = e2.getConfig(`animate`), d2 = n2.onHighlightStarted || e2.getConfig(`onHighlightStarted`), f2 = (n2 == null ? void 0 : n2.onHighlighted) || e2.getConfig(`onHighlighted`), p2 = (a2 == null ? void 0 : a2.onDeselected) || e2.getConfig(`onDeselected`), m2 = e2.getHookOpts();
  a2 && a2 !== n2 && p2 && p2(l2 ? void 0 : o2, a2, m2), d2 && d2(c2 ? void 0 : t2, n2, m2);
  let h2 = !s2 && u2, g2 = false;
  w(e2.getState(`popover`)), e2.setState(`previousStep`, a2), e2.setState(`previousElement`, o2), e2.setState(`activeStep`, n2), e2.setState(`activeElement`, t2);
  let v2 = () => {
    var _a;
    if (e2.getState(`__transitionCallback`) !== v2) return;
    let s3 = Date.now() - i2, l3 = r2 - s3 <= r2 / 2, u3 = (e2.getState(`activeStep`) === n2 ? e2.getState(`activeElement`) : void 0) || t2;
    n2.popover && l3 && !g2 && h2 && (H(e2, u3, n2), g2 = true), e2.getConfig(`animate`) && s3 < r2 ? ie(e2, s3, r2, o2, u3) : (L(e2, u3), f2 && f2(c2 ? void 0 : u3, n2, { ...e2.getHookOpts(), signal: (_a = e2.getState(`__activation`)) == null ? void 0 : _a.controller.signal }), e2.setState(`__transitionCallback`, void 0), e2.setState(`__previousStep`, a2), e2.setState(`__previousElement`, o2), e2.setState(`__activeStep`, n2), e2.setState(`__activeElement`, u3)), window.requestAnimationFrame(v2);
  };
  e2.setState(`__transitionCallback`, v2), window.requestAnimationFrame(v2), document.querySelectorAll(`.driver-active-element-parent`).forEach((e3) => {
    e3.classList.remove(`driver-active-element-parent`, `driver-active-element-parent-no-scroll`);
  }), _(t2, e2.getConfig(`smoothScroll`)), !h2 && n2.popover && H(e2, t2, n2), document.querySelectorAll(`.driver-active-element`).forEach(q), Be(e2, t2, n2);
}
function q(e2) {
  e2.classList.remove(`driver-active-element`, `driver-no-interaction`), Fe(e2);
}
function Be(e2, t2, n2) {
  (n2.disableActiveInteraction ?? e2.getConfig(`disableActiveInteraction`)) && t2.classList.add(`driver-no-interaction`);
  let r2 = t2.parentElement;
  r2 && r2 !== document.body && (r2.classList.add(`driver-active-element-parent`), m(r2) && r2.classList.add(`driver-active-element-parent-no-scroll`)), t2.classList.add(`driver-active-element`), p(t2) || Pe(t2);
}
function Ve() {
  var _a;
  (_a = document.getElementById(`driver-dummy-element`)) == null ? void 0 : _a.remove(), document.querySelectorAll(`.driver-active-element`).forEach((e2) => {
    let t2 = e2.parentElement;
    t2 && t2 !== document.body && t2.classList.remove(`driver-active-element-parent`, `driver-active-element-parent-no-scroll`), q(e2);
  });
}
function He(e2, t2) {
  var _a;
  let n2 = e2.getState(`activeStep`);
  if (!n2) return;
  (/* @__PURE__ */ new Set([e2.getState(`activeElement`), ...document.querySelectorAll(`.driver-active-element`)])).forEach((e3) => {
    var _a2;
    e3 && (q(e3), (_a2 = e3.parentElement) == null ? void 0 : _a2.classList.remove(`driver-active-element-parent`, `driver-active-element-parent-no-scroll`));
  }), Be(e2, t2, n2), e2.setState(`activeElement`, t2), e2.setState(`__activeElement`, t2);
  let r2 = (_a = e2.getState(`popover`)) == null ? void 0 : _a.wrapper, i2 = C(t2);
  r2 && r2.parentElement !== i2 && i2.appendChild(r2), L(e2, t2), Me(e2, t2, n2);
}
const Ue = [`click`, `auxclick`, `contextmenu`, `dblclick`];
function We(e2, t2) {
  var _a;
  let n2 = (_a = e2.getState(`popover`)) == null ? void 0 : _a.wrapper;
  if (n2 && t2.includes(n2)) return `popover`;
  let r2 = e2.getState(`activeElement`);
  return !p(r2) && t2.includes(r2) ? `element` : t2.some((e3) => e3 instanceof Element && e3.classList.contains(`driver-allowed-element`)) ? `allowed` : `outside`;
}
function Ge(e2) {
  let t2 = [];
  for (let n2 = e2; n2; ) t2.push(n2), n2 = n2.parentNode || (n2 instanceof ShadowRoot ? n2.host : null);
  return t2;
}
function Ke(e2, t2) {
  let n2 = We(e2, t2);
  return n2 === `element` || n2 === `allowed`;
}
function qe(e2, t2) {
  return ne(t2[0]) && Ke(e2, t2);
}
function Je(e2) {
  return qe(e2, Ge(document.activeElement));
}
function J(e2) {
  return e2.code || e2.key;
}
function Ye(e2, t2) {
  t2.preventDefault(), t2.stopImmediatePropagation(), e2.consume(t2);
}
function Y(e2) {
  let t2 = e2.getState(`__handledKeys`);
  return t2 || (t2 = /* @__PURE__ */ new Set(), e2.setState(`__handledKeys`, t2)), t2;
}
function Xe(e2, t2) {
  if (!e2.getState(`isInitialized`)) return;
  let n2 = e2.getState(`activeStep`), r2 = (n2 == null ? void 0 : n2.onInteraction) || e2.getConfig(`onInteraction`);
  if (!n2 || !r2 || t2.type === `auxclick` && t2.button === 2) return;
  let i2 = We(e2, t2.composedPath());
  if (i2 === `popover`) return;
  let a2 = e2.getState(`activeElement`);
  r2(p(a2) ? void 0 : a2, n2, { ...e2.getHookOpts(), event: t2, region: i2 }) === false && Ye(e2, t2);
}
function Ze(e2) {
  let t2 = new AbortController(), n2 = (t3) => Xe(e2, t3);
  for (let e3 of Ue) window.addEventListener(e3, n2, { capture: true, signal: t2.signal });
  return window.addEventListener(`blur`, () => e2.setState(`__widgetKey`, void 0), { signal: t2.signal }), () => t2.abort();
}
function X(e2) {
  let t2 = e2.getState(`__resizeTimeout`);
  t2 && window.cancelAnimationFrame(t2), e2.setState(`__resizeTimeout`, window.requestAnimationFrame(() => Re(e2)));
}
function Qe(e2, t2) {
  var _a, _b, _c;
  if (!e2.getState(`isInitialized`) || !(t2.key === `Tab` || t2.keyCode === 9)) return;
  let n2 = e2.getState(`__activeElement`), r2 = (_a = e2.getState(`popover`)) == null ? void 0 : _a.wrapper, i2 = [...new Set(g([...r2 ? [r2] : [], ...n2 ? [n2] : [], ...Array.from(document.querySelectorAll(`.${R}`))]))], a2 = i2[0], o2 = i2[i2.length - 1];
  t2.preventDefault(), t2.shiftKey ? (_b = i2[i2.indexOf(document.activeElement) - 1] || o2) == null ? void 0 : _b.focus() : (_c = i2[i2.indexOf(document.activeElement) + 1] || a2) == null ? void 0 : _c.focus();
}
function $e(e2, t2) {
  Y(e2).add(J(t2)), (qe(e2, t2.composedPath()) || Je(e2)) && e2.setState(`__widgetKey`, J(t2));
}
function et(e2, t2) {
  let n2 = J(t2);
  !t2.defaultPrevented && e2.getState(`__widgetKey`) !== n2 && Y(e2).delete(n2);
}
function tt(e2, t2) {
  let n2 = e2.getConfig(`allowKeyboardControl`) ?? true, r2 = Y(e2).delete(J(t2));
  e2.getState(`__widgetKey`) === J(t2) && e2.setState(`__widgetKey`, void 0), !(!n2 || r2 || Je(e2)) && (t2.key === `Escape` ? e2.emit(`escapePress`) : t2.key === `ArrowRight` ? e2.emit(`arrowRightPress`) : t2.key === `ArrowLeft` && e2.emit(`arrowLeftPress`));
}
function nt(e2) {
  if (e2.getState(`__events`)) return;
  let t2 = (t3) => tt(e2, t3), n2 = (t3) => {
    et(e2, t3), Qe(e2, t3);
  }, r2 = (t3) => $e(e2, t3), i2 = () => X(e2), a2 = () => X(e2);
  e2.setState(`__events`, { onKeyup: t2, onKeydown: n2, onKeydownCapture: r2, onResize: i2, onScroll: a2 }), e2.setState(`__teardownGate`, Ze(e2)), window.addEventListener(`keydown`, r2, true), window.addEventListener(`keyup`, t2, false), window.addEventListener(`keydown`, n2, false), window.addEventListener(`resize`, i2), window.addEventListener(`scroll`, a2);
}
function rt(e2) {
  var _a;
  let t2 = e2.getState(`__events`);
  t2 && (window.removeEventListener(`keyup`, t2.onKeyup), window.removeEventListener(`keydown`, t2.onKeydown), window.removeEventListener(`keydown`, t2.onKeydownCapture, true), (_a = e2.getState(`__teardownGate`)) == null ? void 0 : _a(), window.removeEventListener(`resize`, t2.onResize), window.removeEventListener(`scroll`, t2.onScroll));
}
function it() {
  let e2 = {};
  function t2(t3 = {}) {
    e2 = { animate: true, duration: 400, allowClose: true, allowScroll: true, overlayClickBehavior: `close`, overlayOpacity: 0.7, smoothScroll: false, disableActiveInteraction: false, advanceOnClick: false, skipMissingElement: false, waitForElement: 0, showProgress: false, stagePadding: 10, stageRadius: 5, popoverOffset: 10, showButtons: [`next`, `previous`, `close`], disableButtons: [], overlayColor: `#000`, ...t3 };
  }
  return t2(), { getConfig: ((t3) => t3 ? e2[t3] : e2), configure: t2 };
}
function at() {
  let e2 = {}, t2 = ((t3) => t3 ? e2[t3] : e2), n2 = (t3, n3) => {
    e2[t3] = n3;
  };
  function r2() {
    e2 = {};
  }
  return { getState: t2, setState: n2, resetState: r2 };
}
function ot() {
  let e2 = {};
  function t2(t3, n3) {
    e2[t3] = n3;
  }
  function n2(t3) {
    var _a;
    (_a = e2[t3]) == null ? void 0 : _a.call(e2);
  }
  function r2() {
    e2 = {};
  }
  return { listen: t2, emit: n2, reset: r2 };
}
function st(e2 = {}) {
  let t2 = it();
  t2.configure(e2);
  let n2 = at(), r2 = ot(), i2, a2 = /* @__PURE__ */ new WeakSet();
  return { getConfig: t2.getConfig, setConfig: t2.configure, getState: n2.getState, setState: n2.setState, resetState: n2.resetState, listen: r2.listen, emit: r2.emit, resetEmitter: r2.reset, getDriver: () => i2, setDriver: (e3) => {
    i2 = e3;
  }, getHookOpts: (e3, r3) => {
    let a3 = e3 || n2.getState();
    return { config: t2.getConfig(), state: a3, driver: i2, index: a3.activeIndex, ...r3 ? { reason: r3 } : {} };
  }, consume: (e3) => {
    a2.add(e3);
  }, isConsumed: (e3) => a2.has(e3) };
}
function ct(e2, t2) {
  if (t2.advanceOn !== void 0) return t2.advanceOn || void 0;
  if (t2.advanceOnClick !== void 0) return t2.advanceOnClick ? `click` : void 0;
  let n2 = e2.getConfig(`advanceOn`);
  return n2 === void 0 ? e2.getConfig(`advanceOnClick`) ? `click` : void 0 : n2 || void 0;
}
function lt(e2, t2) {
  if (!t2) return false;
  let n2 = e2.composedPath();
  return n2.length > 0 ? n2.includes(t2) : e2.target instanceof Node && t2.contains(e2.target);
}
function ut(e2, t2, n2, r2) {
  let { signal: i2 } = n2.controller, { event: a2, when: o2 } = typeof t2 == `object` && !Array.isArray(t2) ? t2 : { event: t2 }, s2 = Array.isArray(a2) ? a2 : [a2], c2 = (t3) => {
    if (!o2) return true;
    let r3 = e2.getState(`activeElement`);
    return !!r3 && o2(r3, n2.step, { ...e2.getHookOpts(), event: t3 });
  }, l2, u2, d2 = (t3) => {
    var _a;
    l2 === t3 && (window.clearTimeout(u2), l2 = void 0, u2 = void 0, n2.pendingCompletion = false, !i2.aborted && (!e2.isConsumed(t3) && c2(t3) && r2(), (_a = n2.recheck) == null ? void 0 : _a.call(n2)));
  }, f2 = (t3) => {
    lt(t3, e2.getState(`activeElement`)) && (l2 = t3, n2.pendingCompletion = true, window.clearTimeout(u2), u2 = window.setTimeout(() => d2(t3), 0));
  };
  for (let e3 of s2) window.addEventListener(e3, f2, { capture: true, signal: i2 }), window.addEventListener(e3, d2, { signal: i2 });
  i2.addEventListener(`abort`, () => window.clearTimeout(u2));
}
const Z = `driver-popover-nudge`, Q = /* @__PURE__ */ new WeakMap();
function dt() {
  let e2 = getComputedStyle(document.documentElement).getPropertyValue(`--driver-nudge-duration`).trim(), t2 = parseFloat(e2);
  return Number.isNaN(t2) ? 500 : e2.endsWith(`ms`) || !e2.endsWith(`s`) ? t2 : t2 * 1e3;
}
function ft(e2, t2) {
  window.clearTimeout(Q.get(e2));
  let n2 = () => {
    window.clearTimeout(Q.get(e2)), Q.delete(e2), e2.removeEventListener(`animationend`, r2), t2();
  }, r2 = (e3) => {
    let t3 = e3.animationName;
    t3 && !t3.startsWith(`driver-nudge`) || n2();
  };
  e2.addEventListener(`animationend`, r2), Q.set(e2, window.setTimeout(n2, dt() + 150));
}
function pt(e2) {
  var _a;
  let t2 = (_a = e2.getState(`popover`)) == null ? void 0 : _a.wrapper;
  !e2.getState(`isInitialized`) || !t2 || !t2.isConnected || t2.style.display === `none` || (t2.classList.remove(Z), t2.offsetWidth, t2.classList.add(Z), ft(t2, () => t2.classList.remove(Z)));
}
let $;
function mt(e2 = {}) {
  let t2 = st(e2), n2 = () => P2(`replaced`, false);
  function r2(e3 = `close`) {
    t2.getConfig(`allowClose`) && P2(e3);
  }
  function i2() {
    o2().disableButtons.includes(`close`) || r2(`escape`);
  }
  function a2() {
    var _a;
    return ((_a = t2.getState(`__initialWait`)) == null ? void 0 : _a.step) ?? t2.getState(`__activeStep`);
  }
  function o2() {
    let e3 = a2();
    return we(t2, e3 && ke(t2, e3));
  }
  function s2(e3) {
    if (e3 !== `close` && Te(t2)) return false;
    let { showButtons: n3, disableButtons: r3 } = o2();
    return n3.includes(e3) && !r3.includes(e3);
  }
  function c2() {
    let e3 = t2.getConfig(`overlayClickBehavior`);
    if (t2.getConfig(`allowClose`) && e3 === `close`) {
      P2(`overlay`);
      return;
    }
    if (typeof e3 == `function`) {
      t2.setState(`__destroyReason`, `overlay`);
      let n3 = t2.getState(`__activeStep`);
      e3(t2.getState(`__activeElement`), n3, t2.getHookOpts());
      return;
    }
    e3 === `nextStep` && l2(t2.getState(`activeElement`), t2.getState(`activeStep`));
  }
  function l2(e3, n3) {
    let r3 = be(t2, n3);
    if (r3) {
      B(t2, 1) && t2.setState(`__destroyReason`, `done`), r3(e3, n3, t2.getHookOpts());
      return;
    }
    u2();
  }
  function u2() {
    let e3 = t2.getState(`activeIndex`), n3 = t2.getConfig(`steps`) || [];
    if (e3 === void 0) return;
    let r3 = e3 + 1;
    n3[r3] ? j2(r3) : P2(`done`);
  }
  function d2() {
    let e3 = t2.getState(`activeIndex`), n3 = t2.getConfig(`steps`) || [];
    if (e3 === void 0) return;
    let r3 = e3 - 1;
    n3[r3] ? j2(r3) : P2(`api`);
  }
  function m2(e3) {
    (t2.getConfig(`steps`) || [])[e3] ? j2(e3) : P2(`api`);
  }
  function h2() {
    let e3 = t2.getState(`activeStep`);
    e3 && l2(t2.getState(`activeElement`), e3);
  }
  function g2(e3) {
    t2.getState(`__activation`) !== e3 || e3.latched || (e3.latched = true, h2(), _2(e3));
  }
  function _2(e3) {
    var _a;
    t2.getState(`__activation`) !== e3 || t2.getState(`__pendingWaitCancel`) || (e3.latched = false, (_a = e3.recheck) == null ? void 0 : _a.call(e3));
  }
  function v2() {
    let e3 = t2.getState(`__activation`);
    e3 && (t2.setState(`__activation`, void 0), e3.controller.abort());
  }
  function y2(e3) {
    return e3.onElementMissing || t2.getConfig(`onElementMissing`);
  }
  function b2() {
    let e3 = t2.getState(`__initialWait`);
    return { element: (e3 == null ? void 0 : e3.element) ?? t2.getState(`activeElement`), step: (e3 == null ? void 0 : e3.step) ?? t2.getState(`activeStep`) };
  }
  function x2() {
    let e3 = b2();
    Ne(t2, e3.element, e3.step);
  }
  function S2(e3) {
    let { step: n3 } = e3, { signal: r3 } = e3.controller;
    if (!n3.element || !y2(n3)) return;
    let i3, a3, o3 = false, s3 = () => e3.latched || e3.pendingCompletion || t2.getState(`__pendingWaitCancel`), c3 = (n4) => {
      window.clearTimeout(a3), a3 = void 0, o3 = false, He(t2, n4), !e3.latched && !t2.getState(`__pendingWaitCancel`) && x2();
    }, l3 = () => {
      let e4 = f(n3.element);
      return !e4 || !e4.isConnected ? false : (c3(e4), true);
    }, u3 = (e4) => {
      var _a;
      o3 = true, x2(), (_a = y2(n3)) == null ? void 0 : _a(e4, n3, { ...t2.getHookOpts(), cause: `removed` });
    }, d3 = () => {
      i3 = void 0;
      let e4 = t2.getState(`activeElement`);
      if (r3.aborted || !e4 || p(e4)) return;
      if (e4.isConnected) {
        (o3 || a3 !== void 0) && c3(e4);
        return;
      }
      if (s3() || l3() || o3 || a3) return;
      let d4 = n3.waitForElement ?? t2.getConfig(`waitForElement`) ?? 0;
      if (d4 <= 0) {
        u3(e4);
        return;
      }
      W(t2), a3 = window.setTimeout(() => {
        a3 = void 0, !(r3.aborted || s3() || l3()) && u3(e4);
      }, d4);
    }, m3 = () => {
      i3 === void 0 && (i3 = window.requestAnimationFrame(d3));
    }, h3 = new MutationObserver(m3);
    h3.observe(document.documentElement, { childList: true, subtree: true }), e3.recheck = m3, r3.addEventListener(`abort`, () => {
      h3.disconnect(), window.clearTimeout(a3), i3 !== void 0 && window.cancelAnimationFrame(i3);
    });
  }
  function C2(e3) {
    v2();
    let n3 = { step: e3, controller: new AbortController(), latched: false };
    return t2.setState(`__activation`, n3), t2.setState(`__lastAnnouncement`, void 0), n3;
  }
  function ee2(e3) {
    if (t2.getState(`__activation`) !== e3) return;
    let { step: n3 } = e3;
    pe(t2, n3, e3.controller.signal), S2(e3);
    let r3 = ct(t2, n3);
    r3 && ut(t2, r3, e3, () => g2(e3));
  }
  function te2() {
    if (t2.getState(`__transitionCallback`)) return;
    let e3 = t2.getState(`activeIndex`), n3 = t2.getState(`__activeStep`), r3 = t2.getState(`__activeElement`);
    if (e3 === void 0 || n3 === void 0 || !(t2.getConfig(`steps`) || [])[e3 - 1] || !s2(`previous`)) return;
    let i3 = V(t2, n3);
    if (i3) return i3(r3, n3, t2.getHookOpts());
    d2();
  }
  function ne2() {
    if (t2.getState(`__transitionCallback`)) return;
    let e3 = t2.getState(`activeIndex`), n3 = a2();
    e3 === void 0 || n3 === void 0 || s2(`next`) && l2(t2.getState(`__activeElement`), n3);
  }
  function w2(e3) {
    let n3 = t2.getState(`__activation`);
    if (!n3) return;
    n3.popoverPatch = e3 ? { ...n3.popoverPatch, ...e3 } : void 0;
    let r3 = t2.getState(`popover`), { element: i3, step: a3 } = b2();
    if (!r3 || !i3 || a3 !== n3.step || r3.wrapper.style.display === `none` || !r3.wrapper.isConnected) return;
    let o3 = Te(t2), s3 = U(r3);
    je(t2, i3, n3.step), o3 && W(t2);
    let c3 = U(r3).filter((e4, t3) => e4 && e4 !== s3[t3]);
    ge(t2, c3.join(`. `));
  }
  function T2() {
    t2.getState(`isInitialized`) || ($ && $ !== n2 && $(), $ = n2, t2.setState(`isInitialized`, true), document.body.classList.add(`driver-active`, t2.getConfig(`animate`) ? `driver-fade` : `driver-simple`), t2.getConfig(`allowScroll`) || document.body.classList.add(`driver-no-scroll`), document.body.style.setProperty(`--driver-animation-duration`, `${t2.getConfig(`duration`) || 400}ms`), nt(t2), he(t2), t2.listen(`overlayClick`, c2), t2.listen(`escapePress`, i2), t2.listen(`closeClick`, r2), t2.listen(`arrowLeftPress`, te2), t2.listen(`arrowRightPress`, ne2));
  }
  function E2() {
    let e3 = t2.getState(`__pendingWaitCancel`);
    e3 && (t2.setState(`__pendingWaitCancel`, void 0), e3());
  }
  function D2(e3, n3, r3) {
    let i3 = t2.getState(`__activation`), a3 = (e4) => {
      o3.disconnect(), window.clearTimeout(s3), t2.setState(`__pendingWaitCancel`, void 0), r3(e4), i3 && _2(i3);
    }, o3 = new MutationObserver(() => {
      f(e3.element) && a3(true);
    }), s3 = window.setTimeout(() => a3(false), n3);
    t2.setState(`__pendingWaitCancel`, () => {
      o3.disconnect(), window.clearTimeout(s3);
    }), o3.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
  }
  function O2(e3) {
    let n3 = (t2.getConfig(`steps`) || [])[e3 + 1];
    return Ce(t2, e3, { onNextClick: () => {
      n3 ? j2(e3 + 1) : P2(`done`);
    }, onPrevClick: () => {
      j2(e3 - 1);
    }, onCloseClick: () => {
      P2(`close`);
    } });
  }
  function k2(e3) {
    let n3 = O2(e3);
    if (!n3.popover) return;
    let r3 = Ie();
    M2(e3, true), t2.setState(`__initialWait`, { element: r3, step: n3, index: e3 }), C2(n3), H(t2, r3, n3), W(t2);
  }
  function A2() {
    var _a;
    t2.getState(`__initialWait`) && (t2.setState(`__initialWait`, void 0), F(t2.getState(`popover`)), t2.setState(`popover`, void 0), (_a = document.getElementById(`driver-dummy-element`)) == null ? void 0 : _a.remove());
  }
  function re2(e3) {
    let n3 = O2(e3), r3 = y2(n3);
    if (!r3) {
      j2(e3, true);
      return;
    }
    let i3 = t2.getState(`__activation`);
    x2();
    let a3 = r3(void 0, n3, { ...t2.getHookOpts(), index: e3, cause: `timeout` }), o3 = !t2.getState(`isInitialized`) || t2.getState(`__activation`) !== i3 || t2.getState(`__pendingWaitCancel`);
    a3 === false || o3 || j2(e3, true);
  }
  function j2(e3 = 0, n3 = false) {
    var _a;
    E2(), t2.setState(`__destroyReason`, void 0);
    let r3 = t2.getConfig(`steps`);
    if (!r3) {
      console.error(`No steps to drive through`), P2(`api`);
      return;
    }
    if (!r3[e3]) {
      P2(`api`);
      return;
    }
    let i3 = r3[e3], a3 = i3.waitForElement ?? t2.getConfig(`waitForElement`) ?? 0;
    if (!n3 && a3 > 0 && i3.element && !f(i3.element)) {
      t2.getState(`activeStep`) || ((_a = t2.getState(`__initialWait`)) == null ? void 0 : _a.index) === e3 ? W(t2) : (A2(), k2(e3)), D2(i3, a3, (t3) => {
        t3 ? j2(e3, true) : re2(e3);
      });
      return;
    }
    if (A2(), ye(t2, i3)) {
      let n4 = t2.getState(`activeIndex`), i4 = typeof n4 == `number` && e3 < n4 ? -1 : 1;
      r3[e3 + i4] ? j2(e3 + i4) : i4 === 1 && P2(`done`);
      return;
    }
    M2(e3, false), N2(O2(e3));
  }
  function M2(e3, n3) {
    t2.getState(`__keepReturnFocus`) || t2.setState(`__activeOnDestroyed`, document.activeElement), t2.setState(`__keepReturnFocus`, n3), t2.setState(`activeIndex`, e3);
  }
  function N2(e3) {
    let n3 = C2(e3);
    t2.setState(`__isWaiting`, false), Le(t2, e3), ee2(n3);
  }
  function P2(e3, r3 = true) {
    var _a;
    if (!t2.getState(`isInitialized`)) {
      rt(t2), _e(t2), t2.setState(`__events`, void 0), t2.setState(`__teardownGate`, void 0), t2.setState(`__liveRegion`, void 0);
      return;
    }
    e3 === `api` && (e3 = t2.getState(`__destroyReason`) ?? `api`);
    let i3 = t2.getState(`__activeElement`), a3 = t2.getState(`__activeStep`) ?? ((_a = t2.getState(`__initialWait`)) == null ? void 0 : _a.step), o3 = p(i3) ? void 0 : i3, s3 = t2.getState(`__activeOnDestroyed`), c3 = t2.getConfig(`onDestroyStarted`);
    if (r3 && c3) {
      t2.setState(`__destroyReason`, e3), c3(o3, a3, t2.getHookOpts(void 0, e3));
      return;
    }
    $ === n2 && ($ = void 0);
    let l3 = (a3 == null ? void 0 : a3.onDeselected) || t2.getConfig(`onDeselected`), u3 = t2.getConfig(`onDestroyed`);
    document.body.classList.remove(`driver-active`, `driver-fade`, `driver-simple`, `driver-no-scroll`), document.body.style.removeProperty(`--driver-animation-duration`), E2(), v2(), rt(t2), _e(t2), F(t2.getState(`popover`)), Ve(), ue(t2), t2.resetEmitter();
    let d3 = t2.getState();
    t2.resetState(), a3 && (i3 && l3 && l3(o3, a3, t2.getHookOpts(d3, e3)), u3 == null ? void 0 : u3(o3, a3, t2.getHookOpts(d3, e3))), s3 && s3.focus();
  }
  let I2 = { isActive: () => t2.getState(`isInitialized`) || false, refresh: () => X(t2), drive: (e3 = 0) => {
    T2(), j2(e3);
  }, setConfig: t2.setConfig, setSteps: (e3) => {
    E2(), v2();
    let { __events: n3, __teardownGate: r3, __liveRegion: i3 } = t2.getState();
    t2.resetState(), t2.setState(`__events`, n3), t2.setState(`__teardownGate`, r3), t2.setState(`__liveRegion`, i3), t2.setConfig({ ...t2.getConfig(), steps: e3 });
  }, getConfig: t2.getConfig, getState: t2.getState, getActiveIndex: () => t2.getState(`activeIndex`), isFirstStep: () => B(t2, -1), isLastStep: () => B(t2, 1), getActiveStep: () => t2.getState(`activeStep`), getActiveElement: () => t2.getState(`activeElement`), getPreviousElement: () => t2.getState(`previousElement`), getPreviousStep: () => t2.getState(`previousStep`), getNextStep: () => {
    let e3 = t2.getConfig(`steps`) || [], n3 = t2.getState(`activeIndex`);
    if (n3 === void 0) return;
    let r3 = z(t2, n3 + 1, 1);
    return r3 === void 0 ? void 0 : e3[r3];
  }, moveNext: u2, movePrevious: d2, moveTo: m2, hasNextStep: () => t2.getState(`activeIndex`) !== void 0 && !B(t2, 1), hasPreviousStep: () => t2.getState(`activeIndex`) !== void 0 && !B(t2, -1), highlight: (e3) => {
    T2(), E2(), A2(), t2.setState(`__destroyReason`, void 0), N2({ ...e3, popover: e3.popover ? { showButtons: [], showProgress: false, progressText: ``, ...e3.popover } : void 0 });
  }, updatePopover: w2, nudge: (e3) => {
    e3 && w2(e3), pt(t2);
  }, destroy: () => {
    P2(`api`, false);
  } };
  return t2.setDriver(I2), I2;
}
const TRANSIENT_LAYER_SELECTOR = [
  '[role="menu"]',
  '[role="dialog"]',
  '[role="alertdialog"]'
].join(", ");
function preserveTransientLayerFocus(popover, guide) {
  const target = guide.getActiveElement();
  if (!(target instanceof HTMLElement) || !target.closest(TRANSIENT_LAYER_SELECTOR)) {
    return;
  }
  const buttons = [
    popover.previousButton,
    popover.nextButton,
    popover.closeButton
  ];
  const disabledStates = buttons.map((button) => button.disabled);
  buttons.forEach((button) => {
    button.disabled = true;
  });
  queueMicrotask(() => {
    buttons.forEach((button, index) => {
      button.disabled = disabledStates[index];
    });
    if (target.isConnected) {
      target.focus({ preventScroll: true });
    }
  });
}
function releasePageInteraction() {
  document.body.classList.remove("driver-active");
  document.querySelectorAll(
    ".driver-active-element-parent, .driver-active-element-parent-no-scroll"
  ).forEach((element) => {
    element.classList.remove(
      "driver-active-element-parent",
      "driver-active-element-parent-no-scroll"
    );
  });
}
function trackGuideLayout(guide) {
  let refreshFrame;
  const requestRefresh = () => {
    if (refreshFrame !== void 0) {
      return;
    }
    refreshFrame = window.requestAnimationFrame(() => {
      refreshFrame = void 0;
      guide.refresh();
    });
  };
  document.addEventListener("scroll", requestRefresh, true);
  return () => {
    document.removeEventListener("scroll", requestRefresh, true);
    if (refreshFrame !== void 0) {
      window.cancelAnimationFrame(refreshFrame);
    }
  };
}
function driveGuide(steps) {
  let stopTrackingLayout = () => {
  };
  const guide = mt({
    animate: true,
    allowClose: true,
    allowKeyboardControl: false,
    allowScroll: true,
    smoothScroll: true,
    overlayClickBehavior: "none",
    overlayOpacity: 0.52,
    stagePadding: 6,
    stageRadius: 8,
    showProgress: true,
    progressText: "{{current}} / {{total}}",
    nextBtnText: "下一步",
    prevBtnText: "上一步",
    doneBtnText: "完成",
    closeBtnLabel: "关闭引导",
    onHighlightStarted: () => {
      queueMicrotask(releasePageInteraction);
    },
    onHighlighted: releasePageInteraction,
    onPopoverRender: (popover, opts) => {
      preserveTransientLayerFocus(popover, opts.driver);
    },
    onDestroyed: () => {
      stopTrackingLayout();
      releasePageInteraction();
    },
    steps
  });
  guide.drive();
  stopTrackingLayout = trackGuideLayout(guide);
  releasePageInteraction();
  return guide;
}
const ELEMENT_WAIT_MS$1 = 1e4;
const LONG_ELEMENT_WAIT_MS = 3e4;
async function showBuildStructureView(view = "objects") {
  navigateToGuidePage("console");
  await activateGuideElement("console-build-navigation");
  await activateGuideElement("console-project-structure-tab");
  await activateGuideElement(
    view === "objects" ? "console-controlled-objects-tab" : "console-masters-tab"
  );
}
async function showBuildDebugView() {
  navigateToGuidePage("console");
  await activateGuideElement("console-build-navigation");
  await activateGuideElement("console-build-debug-tab");
}
async function showControlView(tab) {
  navigateToGuidePage("console");
  await activateGuideElement("console-control-navigation");
  await activateGuideElement(
    tab === "manual" ? "console-manual-control-tab" : "console-control-program-tab"
  );
}
async function showActionView(tab = "properties") {
  navigateToGuidePage("console");
  await activateGuideElement("console-action-navigation");
  await activateGuideElement(
    tab === "properties" ? "console-action-properties-tab" : "console-action-program-tab"
  );
}
function showProjectCenter() {
  navigateToGuidePage("project-center");
}
function guideStep(element, options) {
  return {
    element: getGuideSelector(element),
    waitForElement: options.waitForElement ?? ELEMENT_WAIT_MS$1,
    popover: {
      title: options.title,
      description: options.description,
      side: options.side ?? "left",
      align: options.align ?? "start"
    }
  };
}
function clickGuideStep(element, options) {
  const step = guideStep(element, options);
  return {
    ...step,
    advanceOn: "click",
    popover: {
      ...step.popover,
      showButtons: ["previous", "close"]
    }
  };
}
function clickWithinGuideStep(element, trigger, options) {
  const step = guideStep(element, options);
  return {
    ...step,
    advanceOn: {
      event: "click",
      when: (_element, _step, { event }) => event.target instanceof Element && event.target.closest(getGuideSelector(trigger)) !== null
    },
    popover: {
      ...step.popover,
      showButtons: ["previous", "close"]
    }
  };
}
async function startCreateActionGuide() {
  await showActionView("program");
  return driveGuide([
    guideStep("console-action-library", {
      title: "选择动作模板",
      description: "在控台的“动作序列库”中找到目标动作模板，并从该模板开始拖拽。",
      side: "right"
    }),
    guideStep("console-action-drop-zone", {
      title: "创建动作",
      description: "将动作模板拖入目标章节中的目标顺序位置。"
    })
  ]);
}
async function startDeleteActionGuide() {
  await showActionView("program");
  return driveGuide([
    clickWithinGuideStep("console-authoring-program", "console-action-remove", {
      title: "删除动作",
      description: "在目标章节中找到目标动作，点击其右侧的移除按钮。"
    })
  ]);
}
async function startConfigureActionGuide() {
  await showControlView("program");
  return driveGuide([
    guideStep("console-control-program-panel", {
      title: "选择动作",
      description: "加载目标章节，并确认目标动作已经进入推子区。",
      side: "right"
    }),
    guideStep("console-action-faders", {
      title: "配置动作",
      description: "点击目标动作推子顶部的标记区域，配置运行方向、轨迹接入方式或安全组状态。",
      side: "top"
    })
  ]);
}
async function startPrepareActionGuide() {
  await showControlView("program");
  return driveGuide([
    guideStep("console-control-program-panel", {
      title: "加载目标动作",
      description: "加载目标动作所在章节和页面，确认目标动作位于推子区。",
      side: "right"
    }),
    {
      ...guideStep("console-action-faders", {
        title: "准备动作",
        description: "点击目标动作推子底部的“Ready”。",
        side: "top"
      }),
      advanceOn: {
        event: "click",
        when: (_element, _step, { event }) => event.target instanceof Element && event.target.closest('button[aria-label$=" Ready"]') !== null
      },
      popover: {
        title: "准备动作",
        description: "点击目标动作推子底部的“Ready”。",
        showButtons: ["previous", "close"],
        side: "top",
        align: "start"
      }
    },
    {
      element: getGuideSelector("console-action-start-dialog"),
      waitForElement: 800,
      skipMissingElement: true,
      advanceOn: {
        event: "click",
        when: (_element, _step, { event }) => event.target instanceof Element && event.target.closest(
          getGuideSelector("console-action-start-confirm")
        ) !== null
      },
      popover: {
        title: "确认轨迹接入方案",
        description: "需要选择接入位置时，核对方案后点击确认。",
        showButtons: ["previous", "close"],
        side: "top",
        align: "end"
      }
    }
  ]);
}
async function startRunActionGuide() {
  await showControlView("program");
  return driveGuide([
    {
      ...guideStep("console-action-faders", {
        title: "运行动作",
        description: "在已经准备的目标动作推子底部点击“GO”。",
        side: "top"
      }),
      advanceOn: {
        event: "click",
        when: (_element, _step, { event }) => event.target instanceof Element && event.target.closest('button[aria-label$=" GO"]') !== null
      },
      popover: {
        title: "运行动作",
        description: "在已经准备的目标动作推子底部点击“GO”。",
        showButtons: ["close"],
        side: "top",
        align: "start"
      }
    }
  ]);
}
async function startCancelActionPreparationGuide() {
  await showControlView("program");
  return driveGuide([
    guideStep("console-action-faders", {
      title: "取消动作准备",
      description: "点击已准备动作推子顶部的标记区域，再点击“取消准备”。",
      side: "top"
    })
  ]);
}
async function startAdjustActionSpeedGuide() {
  await showControlView("program");
  return driveGuide([
    guideStep("console-action-exec-cards", {
      title: "调整动作运行倍率",
      description: "在目标运行任务卡中拖动“速度倍率”滑块，或使用两侧按钮调整倍率。",
      side: "top"
    })
  ]);
}
async function startStopActionGuide() {
  await showControlView("program");
  return driveGuide([
    {
      ...guideStep("console-action-exec-cards", {
        title: "停止动作",
        description: "在目标运行任务卡中点击“停止”。",
        side: "top"
      }),
      advanceOn: {
        event: "click",
        when: (_element, _step, { event }) => {
          var _a, _b;
          return event.target instanceof Element && ((_b = (_a = event.target.closest("button")) == null ? void 0 : _a.textContent) == null ? void 0 : _b.trim()) === "停止";
        }
      },
      popover: {
        title: "停止动作",
        description: "在目标运行任务卡中点击“停止”。",
        showButtons: ["close"],
        side: "top",
        align: "start"
      }
    }
  ]);
}
const selectActionTemplateStep = () => guideStep("console-action-library", {
  title: "选择动作模板",
  description: "在控台的“动作序列库”中选择目标动作模板，然后点击“下一步”。",
  side: "right"
});
const selectTimelineItemStep = (title, description) => guideStep("console-action-timeline", {
  title,
  description,
  side: "top"
});
async function startCreateActionTemplateGuide() {
  await showActionView();
  return driveGuide([
    clickGuideStep("console-action-template-create", {
      title: "创建动作模板",
      description: "点击控台“动作序列库”右上角的添加按钮。",
      side: "right"
    })
  ]);
}
async function startConfigureActionTemplateGuide() {
  await showActionView();
  return driveGuide([
    selectActionTemplateStep(),
    guideStep("console-action-editor", {
      title: "配置动作模板",
      description: "可在“动作序列库”中右键重命名，并在时间轴工具栏配置运行方式和循环状态。",
      side: "top"
    })
  ]);
}
async function startDeleteActionTemplateGuide() {
  await showActionView();
  return driveGuide([
    selectActionTemplateStep(),
    clickGuideStep("console-action-template-delete", {
      title: "删除动作模板",
      description: "点击时间轴工具栏中的删除按钮。",
      side: "bottom"
    }),
    clickWithinGuideStep(
      "console-action-template-delete-dialog",
      "console-action-template-delete-confirm",
      {
        title: "确认删除动作模板",
        description: "查看删除影响，确认无误后点击“删除”。",
        side: "top",
        align: "end"
      }
    )
  ]);
}
async function startCreateTrajectoryPointGuide() {
  await showActionView();
  return driveGuide([
    selectActionTemplateStep(),
    guideStep("console-3d-scene", {
      title: "选择受控物体",
      description: "在 3D 场景中选择要加入轨迹点的一个或多个受控物体，然后点击“下一步”。",
      side: "right"
    }),
    clickGuideStep("console-action-add-pose", {
      title: "创建轨迹点",
      description: "点击控台的“添加位姿”，在当前时间位置创建业务中的轨迹点。"
    })
  ]);
}
async function startConfigureTrajectoryPointGuide() {
  await showActionView();
  return driveGuide([
    selectActionTemplateStep(),
    selectTimelineItemStep(
      "选择轨迹点",
      "在时间轴中选择目标轨迹点，然后点击“下一步”。"
    ),
    guideStep("console-action-selection-properties", {
      title: "配置轨迹点",
      description: "在属性面板中配置到达时刻以及各虚轴轨迹状态。"
    })
  ]);
}
async function startDeleteTrajectoryPointGuide() {
  await showActionView();
  return driveGuide([
    selectActionTemplateStep(),
    selectTimelineItemStep(
      "选择轨迹点",
      "在时间轴中选择要删除的轨迹点，然后点击“下一步”。"
    ),
    clickGuideStep("console-action-block-delete", {
      title: "删除轨迹点",
      description: "点击属性面板中的“删除”。"
    })
  ]);
}
async function startConfigureVirtualAxisTrajectorySegmentGuide() {
  await showActionView();
  return driveGuide([
    selectActionTemplateStep(),
    selectTimelineItemStep(
      "选择虚轴轨迹段",
      "在时间轴中选择目标运动区间（业务中的虚轴轨迹段），然后点击“下一步”。"
    ),
    guideStep("console-action-selection-properties", {
      title: "配置虚轴轨迹段",
      description: "在属性面板中选择目标虚轴，并按时间或按速度配置运动参数。"
    })
  ]);
}
async function startCreateChapterGuide() {
  await showActionView("program");
  return driveGuide([
    clickGuideStep("console-chapter-create", {
      title: "创建章节",
      description: "点击节目管理区域右上角的“章节”按钮。"
    })
  ]);
}
function getControlledObjectSelectionSteps() {
  return [
    guideStep("console-3d-scene", {
      title: "选择受控物体",
      description: "在 3D 场景中选择目标受控物体，然后点击“下一步”。",
      side: "right"
    })
  ];
}
function showControlledObjectView() {
  return showBuildStructureView("objects");
}
async function startConfigureControlledObjectGuide() {
  await showControlledObjectView();
  return driveGuide([
    ...getControlledObjectSelectionSteps(),
    guideStep("console-controlled-object-properties", {
      title: "配置受控物体",
      description: "根据业务方案，在属性面板中完成需要的配置。"
    })
  ]);
}
async function startCreateControlledObjectGuide() {
  navigateToGuidePage("console");
  await showBuildStructureView("objects");
  return driveGuide([
    guideStep("console-shape-palette", {
      title: "创建受控物体",
      description: "在 3D 场景右侧选择需要的形状，并将它拖拽到场景中的目标位置。放下后即创建受控物体。"
    })
  ]);
}
async function startDeleteControlledObjectGuide() {
  await showControlledObjectView();
  return driveGuide([
    {
      element: getGuideSelector("console-3d-scene"),
      waitForElement: ELEMENT_WAIT_MS$1,
      advanceOn: "contextmenu",
      popover: {
        title: "选择要删除的受控物体",
        description: "在 3D 场景中右键目标受控物体。",
        showButtons: ["close"],
        side: "right",
        align: "start"
      }
    },
    clickGuideStep("console-controlled-object-delete", {
      title: "删除受控物体",
      description: "点击“删除”，引导将自动进入确认步骤。",
      side: "right"
    }),
    clickWithinGuideStep("console-deletion-dialog", "console-deletion-confirm", {
      title: "确认删除",
      description: "查看弹窗中的删除影响，确认无误后点击“删除”。",
      side: "top",
      align: "end"
    })
  ]);
}
async function startControlledObjectChoiceGuide(action, confirm, title, actionDescription, confirmDescription) {
  await showControlView("manual");
  return driveGuide([
    ...getControlledObjectSelectionSteps(),
    clickGuideStep(action, {
      title,
      description: actionDescription
    }),
    clickWithinGuideStep(
      "console-controlled-object-action-dialog",
      confirm,
      {
        title: `确认${title}`,
        description: confirmDescription,
        side: "top",
        align: "end"
      }
    )
  ]);
}
function startEnableControlledObjectGuide() {
  return startControlledObjectChoiceGuide(
    "console-controlled-object-enable",
    "console-controlled-object-enable-on",
    "使能受控物体",
    "确认已选择目标受控物体后，点击“使能”。",
    "核对目标受控物体，点击“使能”完成操作。"
  );
}
function startDisableControlledObjectGuide() {
  return startControlledObjectChoiceGuide(
    "console-controlled-object-enable",
    "console-controlled-object-enable-off",
    "断使能受控物体",
    "确认已选择目标受控物体后，点击“使能”。",
    "核对目标受控物体，点击“断能”完成操作。"
  );
}
function startCoupleControlledObjectGuide() {
  return startControlledObjectChoiceGuide(
    "console-controlled-object-couple",
    "console-controlled-object-couple-on",
    "耦合受控物体",
    "确认已选择目标受控物体后，点击“耦合”。",
    "核对目标受控物体，点击“耦合”开始计算并建立整体控制。"
  );
}
function startUncoupleControlledObjectGuide() {
  return startControlledObjectChoiceGuide(
    "console-controlled-object-couple",
    "console-controlled-object-couple-off",
    "解除受控物体耦合",
    "确认已选择目标受控物体后，点击“耦合”。",
    "核对目标受控物体，点击“解耦”完成操作。"
  );
}
async function startControlledObjectDialogGuide(action, confirm, title, description) {
  await showControlView("manual");
  return driveGuide([
    ...getControlledObjectSelectionSteps(),
    clickGuideStep(action, { title, description }),
    clickWithinGuideStep(
      "console-controlled-object-action-dialog",
      confirm,
      {
        title: `确认${title}`,
        description: `核对目标受控物体后，点击“确认${title.replace("受控物体", "")}”。`,
        side: "top",
        align: "end"
      }
    )
  ]);
}
function startResetControlledObjectGuide() {
  return startControlledObjectDialogGuide(
    "console-controlled-object-reset",
    "console-controlled-object-reset-confirm",
    "复位受控物体",
    "点击“复位”。"
  );
}
function startHomeControlledObjectGuide() {
  return startControlledObjectDialogGuide(
    "console-controlled-object-home",
    "console-controlled-object-home-confirm",
    "回原受控物体",
    "点击“回原”。"
  );
}
async function startStopControlledObjectGuide() {
  await showControlView("manual");
  return driveGuide([
    ...getControlledObjectSelectionSteps(),
    clickGuideStep("console-controlled-object-stop", {
      title: "停止受控物体",
      description: "确认目标受控物体正在运动后，点击“停止”。"
    })
  ]);
}
async function startJogVirtualAxisGuide() {
  await showControlView("manual");
  return driveGuide([
    ...getControlledObjectSelectionSteps(),
    guideStep("console-controlled-object-jog", {
      title: "点动虚轴",
      description: "在目标虚轴一行按住正向或反向点动按钮，达到目标位置后松开。"
    })
  ]);
}
async function startMoveControlledObjectGuide() {
  await showControlView("manual");
  return driveGuide([
    ...getControlledObjectSelectionSteps(),
    clickWithinGuideStep(
      "console-controlled-object-move",
      "console-controlled-object-move-confirm",
      {
        title: "移动受控物体",
        description: "选择绝对或相对方式，填写各虚轴位置值，然后点击“GO”。"
      }
    )
  ]);
}
const ELEMENT_WAIT_MS = 1e4;
function getOpenHitchConfigurationStep() {
  return {
    element: getGuideSelector("console-hitch-config-trigger"),
    waitForElement: ELEMENT_WAIT_MS,
    advanceOn: "click",
    popover: {
      title: "打开吊点配置",
      description: "点击“打开吊点配置”，引导将自动进入下一步。",
      showButtons: ["previous", "close"],
      side: "left",
      align: "start"
    }
  };
}
function getConfigureHitchPositionStep(description) {
  return {
    element: getGuideSelector("console-hitch-position-config"),
    waitForElement: ELEMENT_WAIT_MS,
    popover: {
      title: "配置吊点位置",
      description,
      side: "left",
      align: "start"
    }
  };
}
function getApplyHitchConfigurationStep() {
  return {
    element: getGuideSelector("console-hitch-config-apply"),
    waitForElement: ELEMENT_WAIT_MS,
    advanceOn: "click",
    popover: {
      title: "应用吊点配置",
      description: "点击“应用”保存配置，引导将自动结束。",
      showButtons: ["previous", "close"],
      side: "top",
      align: "end"
    }
  };
}
async function startConfigureHitchPositionGuide() {
  await showControlledObjectView();
  return driveGuide([
    ...getControlledObjectSelectionSteps(),
    getOpenHitchConfigurationStep(),
    getConfigureHitchPositionStep(
      "选择目标吊点并配置其 X、Z 位置，完成后点击“下一步”。"
    ),
    getApplyHitchConfigurationStep()
  ]);
}
async function startAddHitchGuide() {
  await showControlledObjectView();
  return driveGuide([
    ...getControlledObjectSelectionSteps(),
    getOpenHitchConfigurationStep(),
    {
      element: getGuideSelector("console-hitch-add"),
      waitForElement: ELEMENT_WAIT_MS,
      advanceOn: "click",
      popover: {
        title: "新增吊点",
        description: "点击“添加吊点”，引导将自动进入下一步。",
        showButtons: ["previous", "close"],
        side: "left",
        align: "start"
      }
    },
    getConfigureHitchPositionStep(
      "配置新吊点的 X、Z 位置，完成后点击“下一步”。"
    ),
    getApplyHitchConfigurationStep()
  ]);
}
async function startDeleteHitchGuide() {
  await showControlledObjectView();
  return driveGuide([
    ...getControlledObjectSelectionSteps(),
    getOpenHitchConfigurationStep(),
    {
      element: getGuideSelector("console-hitch-position-config"),
      waitForElement: ELEMENT_WAIT_MS,
      advanceOn: {
        event: "click",
        when: (_element, _step, { event }) => event.target instanceof Element && event.target.closest(
          getGuideSelector("console-hitch-delete")
        ) !== null
      },
      popover: {
        title: "删除目标吊点",
        description: "在吊点区域中找到目标吊点，并点击对应的删除按钮。",
        showButtons: ["previous", "close"],
        side: "left",
        align: "start"
      }
    },
    {
      element: getGuideSelector("console-hitch-delete-dialog"),
      waitForElement: 500,
      skipMissingElement: true,
      advanceOn: {
        event: "click",
        when: (_element, _step, { event }) => event.target instanceof Element && event.target.closest(
          getGuideSelector("console-hitch-delete-confirm")
        ) !== null
      },
      popover: {
        title: "确认删除并解绑",
        description: "查看弹窗中的解绑影响，确认无误后点击“删除并解绑”。",
        showButtons: ["previous", "close"],
        side: "top",
        align: "end"
      }
    },
    getApplyHitchConfigurationStep()
  ]);
}
const selectMasterStep = () => guideStep("console-master-tree", {
  title: "选择主控",
  description: "在主控结构中选择目标主控，然后点击“下一步”。",
  side: "right"
});
async function startConfigureMasterGuide() {
  await showBuildStructureView("masters");
  return driveGuide([
    selectMasterStep(),
    guideStep("console-master-properties", {
      title: "配置主控",
      description: "在属性面板中修改目标主控的配置。"
    })
  ]);
}
async function startCreateMasterManuallyGuide() {
  await showBuildStructureView("masters");
  return driveGuide([
    clickGuideStep("console-master-add", {
      title: "手动添加主控",
      description: "点击主控区域的添加按钮。",
      side: "right"
    }),
    clickWithinGuideStep("console-master-add-dialog", "console-master-add-confirm", {
      title: "填写主控配置",
      description: "填写 IP 地址并选择主控型号，然后点击“添加”。",
      side: "top",
      align: "end"
    })
  ]);
}
async function startScanFieldDevicesGuide() {
  await showBuildStructureView("masters");
  return driveGuide([
    clickGuideStep("console-master-scan", {
      title: "扫描主控与实轴",
      description: "点击扫描按钮，等待系统返回扫描结果。",
      side: "right"
    }),
    guideStep("console-master-scan-dialog", {
      title: "查看扫描结果",
      description: "检查发现的主控和实轴；扫描操作到这里已经完成。",
      side: "top",
      waitForElement: LONG_ELEMENT_WAIT_MS
    })
  ]);
}
async function startApplyScanResultsGuide() {
  await showBuildStructureView("masters");
  return driveGuide([
    clickGuideStep("console-master-scan", {
      title: "取得扫描结果",
      description: "点击扫描按钮，等待系统显示可应用的扫描结果。",
      side: "right"
    }),
    clickWithinGuideStep("console-master-scan-dialog", "console-master-scan-apply", {
      title: "应用扫描结果",
      description: "选择要加入工程的主控和实轴，然后点击“添加选中”。",
      side: "top",
      align: "end",
      waitForElement: LONG_ELEMENT_WAIT_MS
    })
  ]);
}
async function startDeleteMasterGuide() {
  await showBuildStructureView("masters");
  return driveGuide([
    {
      ...selectMasterStep(),
      advanceOn: "contextmenu",
      popover: {
        title: "选择要删除的主控",
        description: "在主控结构中右键目标主控。",
        showButtons: ["close"],
        side: "right",
        align: "start"
      }
    },
    clickGuideStep("console-master-delete", {
      title: "删除主控",
      description: "点击“删除”，引导将自动进入确认步骤。",
      side: "right"
    }),
    clickWithinGuideStep("console-deletion-dialog", "console-deletion-confirm", {
      title: "确认删除",
      description: "查看删除影响，确认无误后点击“删除”。",
      side: "top",
      align: "end"
    })
  ]);
}
async function startResetMasterGuide() {
  await showBuildStructureView("masters");
  return driveGuide([
    selectMasterStep(),
    clickGuideStep("console-master-reset", {
      title: "复位主控",
      description: "确认目标主控后，点击“PLC复位”。"
    })
  ]);
}
async function startCreateProjectGuide() {
  showProjectCenter();
  return driveGuide([
    clickGuideStep("project-center-new", {
      title: "新建工程",
      description: "点击“新建工程”，引导将自动打开创建窗口。",
      side: "bottom"
    }),
    clickWithinGuideStep("project-dialog", "project-dialog-confirm", {
      title: "填写工程名称",
      description: "填写工程名称，确认无误后点击“创建”。",
      side: "top",
      align: "end"
    })
  ]);
}
async function startOpenProjectGuide() {
  showProjectCenter();
  return driveGuide([
    guideStep("project-center-projects", {
      title: "选择工程",
      description: "在工程列表中选择要打开的工程，然后点击“下一步”。",
      side: "right"
    }),
    clickGuideStep("project-center-open", {
      title: "打开工程",
      description: "点击“打开工程”完成操作。",
      side: "left"
    })
  ]);
}
async function startDeleteProjectGuide() {
  showProjectCenter();
  return driveGuide([
    guideStep("project-center-projects", {
      title: "选择工程",
      description: "在工程列表中选择要删除的工程，然后点击“下一步”。",
      side: "right"
    }),
    clickGuideStep("project-center-delete", {
      title: "删除工程",
      description: "点击“删除工程”，并在系统确认窗口中核对后确认删除。",
      side: "left"
    })
  ]);
}
async function startAppMenuOperationGuide(target, title, description) {
  navigateToGuidePage("console");
  await activateGuideElement("console-app-menu-trigger");
  return driveGuide([
    clickGuideStep(target, { title, description, side: "right" })
  ]);
}
function startSaveProjectGuide() {
  return startAppMenuOperationGuide(
    "console-app-menu-save",
    "保存工程",
    "点击“保存工程”保存当前工程。"
  );
}
function startCloseProjectGuide() {
  return startAppMenuOperationGuide(
    "console-app-menu-close",
    "关闭工程",
    "点击“关闭工程”；存在未保存修改时，请在随后出现的确认窗口中选择处理方式。"
  );
}
async function startDownloadProjectConfigurationGuide() {
  navigateToGuidePage("console");
  return driveGuide([
    clickGuideStep("console-download-configuration", {
      title: "下载工程配置",
      description: "点击“下载”，将当前工程控制配置发送到主控。",
      side: "bottom",
      waitForElement: 3e4
    })
  ]);
}
async function startEmergencyStopAllGuide() {
  navigateToGuidePage("console");
  return driveGuide([
    clickGuideStep("console-emergency-stop", {
      title: "全场急停",
      description: "确认需要立即停止全场运动后，点击“急停”。",
      side: "bottom"
    })
  ]);
}
const selectRealAxisStep = () => guideStep("console-master-tree", {
  title: "选择实轴",
  description: "在主控结构中展开主控并选择目标实轴，然后点击“下一步”。",
  side: "right"
});
const selectDebugRealAxisStep = () => guideStep("console-real-axis-debug-list", {
  title: "选择实轴",
  description: "在调试列表中选择要操作的一条实轴，然后点击“下一步”。",
  side: "right"
});
async function startCreateRealAxisManuallyGuide() {
  await showBuildStructureView("masters");
  return driveGuide([
    clickWithinGuideStep("console-master-tree", "console-real-axis-add", {
      title: "选择目标主控",
      description: "找到目标主控，点击其右侧添加实轴的按钮；控台界面中实轴显示为“驱动单元”或“电机”。",
      side: "right"
    }),
    clickWithinGuideStep("console-real-axis-add-dialog", "console-real-axis-add-confirm", {
      title: "填写实轴信息",
      description: "选择产品型号和从站口，填写要创建的实轴数量，然后点击“添加”。",
      side: "top",
      align: "end"
    })
  ]);
}
async function startConfigureRealAxisGuide() {
  await showBuildStructureView("masters");
  return driveGuide([
    selectRealAxisStep(),
    guideStep("console-real-axis-properties", {
      title: "配置实轴",
      description: "在属性面板中修改目标实轴的配置。"
    })
  ]);
}
async function startBindGuide(title, description) {
  await showBuildStructureView("masters");
  return driveGuide([
    selectRealAxisStep(),
    guideStep("console-real-axis-bind", { title, description })
  ]);
}
function startBindRealAxisToHitchGuide() {
  return startBindGuide(
    "绑定实轴与吊点",
    "在“绑定吊点”中选择目标受控物体的目标吊点。"
  );
}
function startUnbindRealAxisFromHitchGuide() {
  return startBindGuide(
    "解除实轴与吊点绑定",
    "在“绑定吊点”中选择“未绑定”。"
  );
}
async function startDeleteRealAxisGuide() {
  await showBuildStructureView("masters");
  return driveGuide([
    {
      ...selectRealAxisStep(),
      advanceOn: "contextmenu",
      popover: {
        title: "选择要删除的实轴",
        description: "在主控结构中右键目标实轴。",
        showButtons: ["close"],
        side: "right",
        align: "start"
      }
    },
    clickGuideStep("console-real-axis-delete", {
      title: "删除实轴",
      description: "点击“删除”，引导将自动进入确认步骤。",
      side: "right"
    }),
    clickWithinGuideStep("console-deletion-dialog", "console-deletion-confirm", {
      title: "确认删除",
      description: "查看删除影响，确认无误后点击“删除”。",
      side: "top",
      align: "end"
    })
  ]);
}
async function startDebugButtonGuide(target, title, description) {
  await showBuildDebugView();
  if (target === "console-real-axis-enable" || target === "console-real-axis-disable" || target === "console-real-axis-reset") {
    await activateGuideElement("console-real-axis-more");
  }
  return driveGuide([
    selectDebugRealAxisStep(),
    clickGuideStep(target, { title, description, side: "top" })
  ]);
}
function startEnableRealAxisGuide() {
  return startDebugButtonGuide(
    "console-real-axis-enable",
    "使能实轴",
    "展开“更多”，然后点击“使能”。"
  );
}
function startDisableRealAxisGuide() {
  return startDebugButtonGuide(
    "console-real-axis-disable",
    "断使能实轴",
    "展开“更多”，然后点击“断使能”。"
  );
}
function startResetRealAxisGuide() {
  return startDebugButtonGuide(
    "console-real-axis-reset",
    "复位实轴",
    "展开“更多”，点击“复位”，并在系统确认窗口中确认。"
  );
}
function startStopRealAxisGuide() {
  return startDebugButtonGuide(
    "console-real-axis-stop",
    "停止实轴",
    "点击“停止”，使目标实轴平稳停止。"
  );
}
function startSetRealAxisOriginGuide() {
  return startDebugButtonGuide(
    "console-real-axis-origin",
    "设置实轴原点",
    "点击“设原点”，并在系统确认窗口中确认。"
  );
}
async function startJogRealAxisGuide() {
  await showBuildDebugView();
  return driveGuide([
    selectDebugRealAxisStep(),
    guideStep("console-real-axis-jog", {
      title: "点动实轴",
      description: "按住正向或反向点动按钮使实轴运动，达到目标位置后松开。",
      side: "top"
    })
  ]);
}
async function startMoveRealAxisGuide() {
  await showBuildDebugView();
  return driveGuide([
    selectDebugRealAxisStep(),
    clickGuideStep("console-real-axis-move", {
      title: "打开位置移动",
      description: "点击“位置移动”。",
      side: "top"
    }),
    clickWithinGuideStep("console-real-axis-move-dialog", "console-real-axis-move-confirm", {
      title: "移动实轴",
      description: "选择绝对或相对方式并填写位置值，然后点击“执行”。",
      side: "top",
      align: "end"
    })
  ]);
}
const GUIDE_STARTERS = {
  "add-hitch": startAddHitchGuide,
  "adjust-action-speed": startAdjustActionSpeedGuide,
  "apply-scan-results": startApplyScanResultsGuide,
  "bind-real-axis-to-hitch": startBindRealAxisToHitchGuide,
  "cancel-action-preparation": startCancelActionPreparationGuide,
  "close-project": startCloseProjectGuide,
  "configure-action": startConfigureActionGuide,
  "configure-action-template": startConfigureActionTemplateGuide,
  "configure-controlled-object": startConfigureControlledObjectGuide,
  "configure-hitch-position": startConfigureHitchPositionGuide,
  "configure-master": startConfigureMasterGuide,
  "configure-real-axis": startConfigureRealAxisGuide,
  "configure-trajectory-point": startConfigureTrajectoryPointGuide,
  "configure-virtual-axis-trajectory-segment": startConfigureVirtualAxisTrajectorySegmentGuide,
  "couple-controlled-object": startCoupleControlledObjectGuide,
  "create-action": startCreateActionGuide,
  "create-action-template": startCreateActionTemplateGuide,
  "create-chapter": startCreateChapterGuide,
  "create-controlled-object": startCreateControlledObjectGuide,
  "create-master-manually": startCreateMasterManuallyGuide,
  "create-project": startCreateProjectGuide,
  "create-real-axes-manually": startCreateRealAxisManuallyGuide,
  "create-trajectory-point": startCreateTrajectoryPointGuide,
  "delete-action": startDeleteActionGuide,
  "delete-action-template": startDeleteActionTemplateGuide,
  "delete-controlled-object": startDeleteControlledObjectGuide,
  "delete-hitch": startDeleteHitchGuide,
  "delete-master": startDeleteMasterGuide,
  "delete-project": startDeleteProjectGuide,
  "delete-real-axis": startDeleteRealAxisGuide,
  "delete-trajectory-point": startDeleteTrajectoryPointGuide,
  "disable-controlled-object": startDisableControlledObjectGuide,
  "disable-real-axes": startDisableRealAxisGuide,
  "download-project-configuration": startDownloadProjectConfigurationGuide,
  "emergency-stop-all": startEmergencyStopAllGuide,
  "enable-controlled-object": startEnableControlledObjectGuide,
  "enable-real-axes": startEnableRealAxisGuide,
  "home-controlled-object": startHomeControlledObjectGuide,
  "jog-real-axes": startJogRealAxisGuide,
  "jog-virtual-axis": startJogVirtualAxisGuide,
  "move-controlled-object": startMoveControlledObjectGuide,
  "move-real-axes": startMoveRealAxisGuide,
  "open-project": startOpenProjectGuide,
  "prepare-action": startPrepareActionGuide,
  "reset-controlled-object": startResetControlledObjectGuide,
  "reset-real-axis": startResetRealAxisGuide,
  "reset-master": startResetMasterGuide,
  "run-action": startRunActionGuide,
  "save-project": startSaveProjectGuide,
  "scan-field-devices": startScanFieldDevicesGuide,
  "set-real-axis-origin": startSetRealAxisOriginGuide,
  "stop-action": startStopActionGuide,
  "stop-controlled-object": startStopControlledObjectGuide,
  "stop-real-axes": startStopRealAxisGuide,
  "unbind-real-axis-from-hitch": startUnbindRealAxisFromHitchGuide,
  "uncouple-controlled-object": startUncoupleControlledObjectGuide
};
function startGuide(guideId) {
  return GUIDE_STARTERS[guideId]();
}
function isAgentGuideMessage(value) {
  if (!value || typeof value !== "object") {
    return false;
  }
  const message = value;
  return message.type === "pando-agent/guide" && message.version === 1 && typeof message.guideId === "string" && message.guideId in GUIDE_STARTERS;
}
function useGuide(frameRef) {
  const activeGuideRef = useRef();
  useEffect(() => {
    let disposed = false;
    const receiveGuide = (event) => {
      var _a, _b;
      if (event.source !== ((_a = frameRef.current) == null ? void 0 : _a.contentWindow) || !isAgentGuideMessage(event.data)) {
        return;
      }
      (_b = activeGuideRef.current) == null ? void 0 : _b.destroy();
      void startGuide(event.data.guideId).then((guide) => {
        if (disposed) {
          guide.destroy();
          return;
        }
        activeGuideRef.current = guide;
      }).catch((error) => {
        console.error("Failed to start agent guide.", error);
      });
    };
    window.addEventListener("message", receiveGuide);
    return () => {
      var _a;
      disposed = true;
      window.removeEventListener("message", receiveGuide);
      (_a = activeGuideRef.current) == null ? void 0 : _a.destroy();
    };
  }, [frameRef]);
}
/**
 * @license lucide-react v1.60.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
const toKebabCase = (string) => string == null ? void 0 : string.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
/**
 * @license lucide-react v1.60.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
function toLucideIconData(iconName, iconNode, aliases = []) {
  if (iconNode == null) {
    throw new Error("[lucide]: iconNode is required when icon name is used");
  }
  return {
    name: toKebabCase(iconName),
    size: 24,
    node: iconNode,
    ...aliases.length > 0 ? { aliases } : {}
  };
}
/**
 * @license lucide-react v1.60.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
const toCamelCase = (string) => {
  let out = "";
  let upperNext = false;
  for (const ch of string) {
    if (ch === "-" || ch === "_" || ch <= " ") {
      upperNext = out.length > 0;
      continue;
    }
    if (out.length === 0) {
      out += ch.toLowerCase();
    } else {
      out += upperNext ? ch.toUpperCase() : ch;
    }
    upperNext = false;
  }
  return out;
};
/**
 * @license lucide-react v1.60.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
const toPascalCase = (string) => {
  const camelCase = toCamelCase(string);
  return camelCase.charAt(0).toUpperCase() + camelCase.slice(1);
};
/**
 * @license lucide-react v1.60.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
const mergeClasses = (...classes) => classes.filter((className, index, array) => {
  return Boolean(className) && className.trim() !== "" && array.indexOf(className) === index;
}).join(" ").trim();
/**
 * @license lucide-react v1.60.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
const defaultAttributes = {
  xmlns: "http://www.w3.org/2000/svg",
  width: 24,
  height: 24,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  "stroke-width": 2,
  "stroke-linecap": "round",
  "stroke-linejoin": "round"
};
/**
 * @license lucide-react v1.60.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
function isDefined(value) {
  return value !== null && value !== void 0;
}
function buildLucideIconNode(icon, params = {}) {
  var _a, _b;
  const attributeNames = params.attributeNames ?? {};
  const getAttributeName = (attributeName) => attributeNames[attributeName] ?? attributeName;
  const viewBoxWidth = icon.size ?? icon.width ?? defaultAttributes["width"];
  const viewBoxHeight = icon.size ?? icon.height ?? defaultAttributes["height"];
  const aliasClassNames = ((_a = icon.aliases) == null ? void 0 : _a.filter((alias) => typeof alias === "string" && alias.trim() !== "").map((alias) => `lucide-${alias}`)) ?? [];
  const iconClassNames = [...icon.name ? [`lucide-${icon.name}`] : [], ...aliasClassNames];
  const classNamesFromClassName = ((_b = params.className) == null ? void 0 : _b.split(" ").filter(Boolean)) ?? [];
  const className = params.includeDefaultClasses === false ? mergeClasses(...classNamesFromClassName) : mergeClasses("lucide", ...iconClassNames, ...classNamesFromClassName);
  const calculatedStrokeWidth = params.absoluteStrokeWidth ? Number(params.strokeWidth ?? defaultAttributes["stroke-width"]) * Number(icon.size ?? icon.width ?? defaultAttributes["width"]) / Number(params.size ?? params.width ?? defaultAttributes["width"]) : params.strokeWidth ?? defaultAttributes["stroke-width"];
  const attributes = {
    ...Object.entries(defaultAttributes).reduce((attrs, [attrName, value]) => {
      attrs[getAttributeName(attrName)] = value;
      return attrs;
    }, {}),
    ..."color" in params && params.color && {
      [getAttributeName("stroke")]: params.color
    },
    ..."size" in params && isDefined(params.size) && {
      [getAttributeName("width")]: params.size,
      [getAttributeName("height")]: params.size
    },
    ..."width" in params && isDefined(params.width) && {
      [getAttributeName("width")]: params.width
    },
    ..."height" in params && isDefined(params.height) && {
      [getAttributeName("height")]: params.height
    },
    [getAttributeName("stroke-width")]: calculatedStrokeWidth,
    ...className && {
      [getAttributeName("class")]: className
    },
    [getAttributeName("viewBox")]: `0 0 ${viewBoxWidth} ${viewBoxHeight}`,
    ...params.hasA11yProp === false ? {
      [getAttributeName("aria-hidden")]: "true"
    } : {},
    ..."attributes" in params && params.attributes
  };
  return [
    "svg",
    attributes,
    icon.node.map((child) => {
      const [name, attrs, children] = child;
      const nextAttrs = params.nonScalingStroke ? { [getAttributeName("vector-effect")]: "non-scaling-stroke", ...attrs } : attrs;
      return children ? [name, nextAttrs, children] : [name, nextAttrs];
    })
  ];
}
/**
 * @license lucide-react v1.60.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
function buildLucideIconForReact(icon, params = {}) {
  return buildLucideIconNode(icon, {
    ...params,
    attributeNames: {
      ...params.attributeNames,
      class: "className",
      "stroke-width": "strokeWidth",
      "stroke-linecap": "strokeLinecap",
      "stroke-linejoin": "strokeLinejoin",
      "vector-effect": "vectorEffect"
    }
  });
}
/**
 * @license lucide-react v1.60.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
const hasA11yProp = (props) => {
  for (const prop in props) {
    if (prop.startsWith("aria-") || prop === "role" || prop === "title") {
      return true;
    }
  }
  return false;
};
const LucideContext = createContext({});
const useLucideContext = () => useContext(LucideContext);
const Icon = forwardRef(
  ({
    color,
    size,
    width,
    height,
    strokeWidth,
    absoluteStrokeWidth,
    nonScalingStroke,
    className = "",
    children,
    iconNode = [],
    icon = {
      node: iconNode,
      aliases: [],
      size: 24
    },
    ...rest
  }, ref) => {
    const {
      size: contextSize = 24,
      strokeWidth: contextStrokeWidth = 2,
      absoluteStrokeWidth: contextAbsoluteStrokeWidth = false,
      nonScalingStroke: contextNonScalingStroke = false,
      color: contextColor = "currentColor",
      className: contextClass = ""
    } = useLucideContext() ?? {};
    const hasAccessibleProp = Boolean(children) || hasA11yProp(rest);
    const [name, svgAttributes, builtIconNode = []] = buildLucideIconForReact(icon, {
      color: color ?? contextColor,
      width: width ?? size ?? contextSize,
      height: height ?? size ?? contextSize,
      strokeWidth: strokeWidth ?? contextStrokeWidth,
      absoluteStrokeWidth: absoluteStrokeWidth ?? contextAbsoluteStrokeWidth,
      nonScalingStroke: nonScalingStroke ?? contextNonScalingStroke,
      className: mergeClasses(contextClass, className),
      hasA11yProp: hasAccessibleProp,
      attributes: rest
    });
    return createElement(
      name,
      {
        ref,
        ...svgAttributes
      },
      [
        ...builtIconNode.map(([tag, attrs]) => createElement(tag, attrs)),
        ...Array.isArray(children) ? children : [children]
      ]
    );
  }
);
/**
 * @license lucide-react v1.60.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
function createLucideIcon(iconDataOrName, iconNode = [], aliases = []) {
  const iconData = typeof iconDataOrName === "string" ? toLucideIconData(iconDataOrName, iconNode, aliases) : iconDataOrName;
  const Component = forwardRef(
    ({ className, ...props }, ref) => createElement(Icon, {
      ref,
      icon: iconData,
      className,
      ...props
    })
  );
  if (iconData.name) {
    Component.displayName = toPascalCase(iconData.name);
  }
  return Component;
}
/**
 * @license lucide-react v1.60.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
const __iconData$2 = {
  name: "bot",
  size: 24,
  node: [
    ["path", { d: "M12 8V4H8", key: "hb8ula" }],
    ["rect", { width: "16", height: "12", x: "4", y: "8", rx: "2", key: "enze0r" }],
    ["path", { d: "M2 14h2", key: "vft8re" }],
    ["path", { d: "M20 14h2", key: "4cs60a" }],
    ["path", { d: "M15 13v2", key: "1xurst" }],
    ["path", { d: "M9 13v2", key: "rq6x2g" }]
  ]
};
__iconData$2.node;
const Bot = createLucideIcon(__iconData$2);
/**
 * @license lucide-react v1.60.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
const __iconData$1 = {
  name: "message-circle",
  size: 24,
  node: [
    [
      "path",
      {
        d: "M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 1 0-4.777-4.719",
        key: "1sd12s"
      }
    ]
  ]
};
__iconData$1.node;
const MessageCircle = createLucideIcon(__iconData$1);
/**
 * @license lucide-react v1.60.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
const __iconData = {
  name: "minus",
  size: 24,
  node: [["path", { d: "M5 12h14", key: "1ays0h" }]]
};
__iconData.node;
const Minus = createLucideIcon(__iconData);
function AssistantPet({
  dragging,
  elementRef,
  open,
  position,
  dragProps,
  consumeDraggedClick,
  onOpen
}) {
  const handleOpen = () => {
    if (!consumeDraggedClick()) onOpen();
  };
  const handleKeyDown = (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    onOpen();
  };
  const style = {
    transform: `translate3d(${position.x}px, ${position.y}px, 0)`
  };
  return /* @__PURE__ */ jsxs(
    "button",
    {
      ref: elementRef,
      className: "pando-workbench-pet",
      "data-dragging": dragging,
      "data-open": open,
      style,
      type: "button",
      title: "展开智能向导",
      "aria-label": "展开智能向导",
      "aria-hidden": open,
      "aria-expanded": open,
      tabIndex: open ? -1 : 0,
      onClick: handleOpen,
      onKeyDown: handleKeyDown,
      ...dragProps(),
      children: [
        /* @__PURE__ */ jsx("span", { className: "pando-workbench-pet__antenna", "aria-hidden": "true", children: /* @__PURE__ */ jsx("span", {}) }),
        /* @__PURE__ */ jsx("span", { className: "pando-workbench-pet__head", "aria-hidden": "true", children: /* @__PURE__ */ jsx(Bot, { className: "pando-workbench-pet__face", size: 25, strokeWidth: 1.65 }) }),
        /* @__PURE__ */ jsx("span", { className: "pando-workbench-pet__body", "aria-hidden": "true", children: /* @__PURE__ */ jsx(MessageCircle, { size: 15, strokeWidth: 1.8 }) })
      ]
    }
  );
}
const RESIZE_DIRECTIONS = [
  "n",
  "e",
  "s",
  "w",
  "ne",
  "nw",
  "se",
  "sw"
];
function FloatingPanel({
  bounds,
  dragging,
  elementRef,
  open,
  resizing,
  state,
  title,
  children,
  dragProps,
  getResizeProps,
  onClose
}) {
  const style = {
    width: bounds.width,
    height: bounds.height,
    transform: `translate3d(${bounds.x}px, ${bounds.y}px, 0)`
  };
  return /* @__PURE__ */ jsxs(
    "aside",
    {
      ref: elementRef,
      className: "pando-workbench-window",
      "data-dragging": dragging,
      "data-open": open,
      "data-resizing": resizing,
      style,
      "aria-label": "智能向导浮窗",
      "aria-hidden": !open,
      children: [
        /* @__PURE__ */ jsxs("div", { className: "pando-workbench-window__drag-handle", ...dragProps(), children: [
          /* @__PURE__ */ jsxs("div", { className: "pando-workbench-window__identity", children: [
            /* @__PURE__ */ jsx("span", { className: "pando-workbench-window__icon", "aria-hidden": "true", children: /* @__PURE__ */ jsx(Bot, { size: 14, strokeWidth: 1.8 }) }),
            /* @__PURE__ */ jsx("strong", { className: "pando-workbench-window__title", children: title })
          ] }),
          /* @__PURE__ */ jsxs("div", { className: "pando-workbench-window__actions", children: [
            /* @__PURE__ */ jsx(ConnectionStatus, { connection: state.connection }),
            /* @__PURE__ */ jsx(
              "button",
              {
                className: "pando-workbench-window__close",
                type: "button",
                title: "收起智能向导",
                "aria-label": "收起智能向导",
                onPointerDown: (event) => event.stopPropagation(),
                onClick: onClose,
                children: /* @__PURE__ */ jsx(Minus, { size: 16, "aria-hidden": "true" })
              }
            )
          ] })
        ] }),
        /* @__PURE__ */ jsx("div", { className: "pando-workbench-window__content", children }),
        RESIZE_DIRECTIONS.map((direction) => /* @__PURE__ */ jsx(
          "span",
          {
            className: `pando-workbench-window__resize pando-workbench-window__resize--${direction}`,
            ...getResizeProps(direction)
          },
          direction
        ))
      ]
    }
  );
}
function ConnectionStatus({
  connection
}) {
  const label = connection === "online" ? "在线" : connection === "error" ? "连接异常" : connection === "connecting" ? "连接中" : "启动中";
  return /* @__PURE__ */ jsxs(
    "span",
    {
      className: "pando-workbench-window__status",
      "data-status": connection,
      children: [
        /* @__PURE__ */ jsx(
          "span",
          {
            className: "pando-workbench-window__status-dot",
            "aria-hidden": "true"
          }
        ),
        label
      ]
    }
  );
}
const VIEWPORT_MARGIN = 12;
function getViewportSize() {
  return { width: window.innerWidth, height: window.innerHeight };
}
function resolveBounds(defaultBounds, minSize, viewport) {
  const width = Math.min(
    Math.max(400, minSize.width),
    viewport.width - VIEWPORT_MARGIN * 2
  );
  const height = Math.min(
    Math.max(680, minSize.height),
    viewport.height - VIEWPORT_MARGIN * 2
  );
  return clampBounds({
    x: viewport.width - width - VIEWPORT_MARGIN,
    y: viewport.height - height - VIEWPORT_MARGIN,
    width,
    height
  }, minSize, viewport);
}
function clampBounds(bounds, minSize, viewport) {
  const width = clamp(
    bounds.width,
    Math.min(minSize.width, viewport.width - VIEWPORT_MARGIN * 2),
    viewport.width - VIEWPORT_MARGIN * 2
  );
  const height = clamp(
    bounds.height,
    Math.min(minSize.height, viewport.height - VIEWPORT_MARGIN * 2),
    viewport.height - VIEWPORT_MARGIN * 2
  );
  return {
    width,
    height,
    x: clamp(bounds.x, VIEWPORT_MARGIN, viewport.width - width - VIEWPORT_MARGIN),
    y: clamp(bounds.y, VIEWPORT_MARGIN, viewport.height - height - VIEWPORT_MARGIN)
  };
}
function clampPoint(point, size, viewport) {
  return {
    x: clamp(point.x, VIEWPORT_MARGIN, viewport.width - size.width - VIEWPORT_MARGIN),
    y: clamp(point.y, VIEWPORT_MARGIN, viewport.height - size.height - VIEWPORT_MARGIN)
  };
}
function resizeBounds(bounds, direction, deltaX, deltaY, minSize) {
  const viewport = getViewportSize();
  const minimumWidth = Math.min(minSize.width, viewport.width - VIEWPORT_MARGIN * 2);
  const minimumHeight = Math.min(minSize.height, viewport.height - VIEWPORT_MARGIN * 2);
  let left = bounds.x;
  let right = bounds.x + bounds.width;
  let top = bounds.y;
  let bottom = bounds.y + bounds.height;
  if (direction.includes("e")) {
    right = clamp(right + deltaX, left + minimumWidth, viewport.width - VIEWPORT_MARGIN);
  }
  if (direction.includes("w")) {
    left = clamp(left + deltaX, VIEWPORT_MARGIN, right - minimumWidth);
  }
  if (direction.includes("s")) {
    bottom = clamp(bottom + deltaY, top + minimumHeight, viewport.height - VIEWPORT_MARGIN);
  }
  if (direction.includes("n")) {
    top = clamp(top + deltaY, VIEWPORT_MARGIN, bottom - minimumHeight);
  }
  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top
  };
}
function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), Math.max(minimum, maximum));
}
const DRAG_THRESHOLD = 5;
function usePointerDrag({
  onPreview,
  onCommit
}) {
  const interactionRef = useRef();
  const suppressClickRef = useRef(false);
  const [dragging, setDragging] = useState(false);
  const preview = useCallback((interaction) => {
    onPreview({
      x: interaction.offsetX,
      y: interaction.offsetY
    });
  }, [onPreview]);
  const onPointerDown = useCallback((event) => {
    if (event.button !== 0) return;
    interactionRef.current = {
      pointerId: event.pointerId,
      originX: event.clientX,
      originY: event.clientY,
      offsetX: 0,
      offsetY: 0,
      moved: false,
      frame: null
    };
    suppressClickRef.current = false;
    event.currentTarget.setPointerCapture(event.pointerId);
  }, []);
  const onPointerMove = useCallback((event) => {
    const interaction = interactionRef.current;
    if (!interaction || interaction.pointerId !== event.pointerId) return;
    interaction.offsetX = event.clientX - interaction.originX;
    interaction.offsetY = event.clientY - interaction.originY;
    if (!interaction.moved && Math.hypot(interaction.offsetX, interaction.offsetY) < DRAG_THRESHOLD) {
      return;
    }
    if (!interaction.moved) {
      interaction.moved = true;
      setDragging(true);
    }
    if (interaction.frame === null) {
      const pointerId = interaction.pointerId;
      interaction.frame = requestAnimationFrame(() => {
        const current = interactionRef.current;
        if (!current || current.pointerId !== pointerId) {
          return;
        }
        current.frame = null;
        preview(current);
      });
    }
  }, [preview]);
  const finishPointer = useCallback((event) => {
    const interaction = interactionRef.current;
    if (!interaction || interaction.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (interaction.frame !== null) {
      cancelAnimationFrame(interaction.frame);
      interaction.frame = null;
    }
    if (interaction.moved) {
      interaction.offsetX = event.clientX - interaction.originX;
      interaction.offsetY = event.clientY - interaction.originY;
      preview(interaction);
      onCommit({
        x: interaction.offsetX,
        y: interaction.offsetY
      });
    }
    suppressClickRef.current = interaction.moved;
    interactionRef.current = void 0;
    setDragging(false);
  }, [onCommit, preview]);
  useEffect(() => () => {
    var _a;
    const frame = (_a = interactionRef.current) == null ? void 0 : _a.frame;
    if (frame !== null && frame !== void 0) {
      cancelAnimationFrame(frame);
    }
  }, []);
  return {
    dragging,
    consumeDraggedClick: () => {
      const dragged = suppressClickRef.current;
      suppressClickRef.current = false;
      return dragged;
    },
    getDragProps: () => ({
      onPointerDown,
      onPointerMove,
      onPointerUp: finishPointer,
      onPointerCancel: finishPointer
    })
  };
}
function useResizable({
  bounds,
  minSize,
  onPreview,
  onCommit
}) {
  const activeResizeRef = useRef();
  const [resizing, setResizing] = useState(false);
  const onPointerDown = useCallback((direction, event) => {
    if (event.button !== 0) return;
    activeResizeRef.current = {
      pointerId: event.pointerId,
      direction,
      bounds,
      previewBounds: bounds,
      x: event.clientX,
      y: event.clientY,
      frame: null
    };
    setResizing(true);
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
    event.stopPropagation();
  }, [bounds]);
  const onPointerMove = useCallback((event) => {
    const activeResize = activeResizeRef.current;
    if (!activeResize || activeResize.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - activeResize.x;
    const deltaY = event.clientY - activeResize.y;
    activeResize.previewBounds = resizeBounds(
      activeResize.bounds,
      activeResize.direction,
      deltaX,
      deltaY,
      minSize
    );
    if (activeResize.frame === null) {
      const pointerId = activeResize.pointerId;
      activeResize.frame = requestAnimationFrame(() => {
        const current = activeResizeRef.current;
        if (!current || current.pointerId !== pointerId) {
          return;
        }
        current.frame = null;
        onPreview(current.previewBounds);
      });
    }
  }, [minSize, onPreview]);
  const finishResize = useCallback((event) => {
    const activeResize = activeResizeRef.current;
    if ((activeResize == null ? void 0 : activeResize.pointerId) !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (activeResize.frame !== null) {
      cancelAnimationFrame(activeResize.frame);
    }
    onPreview(activeResize.previewBounds);
    onCommit(activeResize.previewBounds);
    activeResizeRef.current = void 0;
    setResizing(false);
  }, [onCommit, onPreview]);
  useEffect(() => () => {
    const activeResize = activeResizeRef.current;
    if (activeResize && activeResize.frame !== null) {
      cancelAnimationFrame(activeResize.frame);
    }
  }, []);
  return {
    resizing,
    getResizeProps: (direction) => ({
      onPointerDown: (event) => onPointerDown(direction, event),
      onPointerMove,
      onPointerUp: finishResize,
      onPointerCancel: finishResize
    })
  };
}
const DEFAULT_MIN_SIZE = {
  width: 320,
  height: 420
};
const PET_SIZE = {
  width: 76,
  height: 82
};
function useWindow(defaultBounds, configuredMinSize) {
  const minSize = DEFAULT_MIN_SIZE;
  const [open, setOpen] = useState(true);
  const [bounds, setBounds] = useState(() => resolveBounds(
    defaultBounds,
    minSize,
    getViewportSize()
  ));
  const [petPosition, setPetPosition] = useState(() => clampPoint({
    x: getViewportSize().width - PET_SIZE.width - VIEWPORT_MARGIN,
    y: getViewportSize().height - PET_SIZE.height - VIEWPORT_MARGIN
  }, PET_SIZE, getViewportSize()));
  const panelRef = useRef(null);
  const petRef = useRef(null);
  const previewPanelMove = useCallback((offset) => {
    const next = clampBounds({
      ...bounds,
      x: bounds.x + offset.x,
      y: bounds.y + offset.y
    }, minSize, getViewportSize());
    setTranslation(panelRef.current, next.x, next.y);
  }, [bounds, minSize]);
  const commitPanelMove = useCallback((offset) => {
    setBounds((current) => clampBounds({
      ...current,
      x: current.x + offset.x,
      y: current.y + offset.y
    }, minSize, getViewportSize()));
  }, [minSize]);
  const previewPetMove = useCallback((offset) => {
    const next = clampPoint({
      x: petPosition.x + offset.x,
      y: petPosition.y + offset.y
    }, PET_SIZE, getViewportSize());
    setTranslation(petRef.current, next.x, next.y);
  }, [petPosition]);
  const commitPetMove = useCallback((offset) => {
    setPetPosition((current) => clampPoint({
      x: current.x + offset.x,
      y: current.y + offset.y
    }, PET_SIZE, getViewportSize()));
  }, []);
  const panelDrag = usePointerDrag({
    onPreview: previewPanelMove,
    onCommit: commitPanelMove
  });
  const petDrag = usePointerDrag({
    onPreview: previewPetMove,
    onCommit: commitPetMove
  });
  const previewPanelResize = useCallback((next) => {
    setBoundsStyle(panelRef.current, next);
  }, []);
  const commitPanelResize = useCallback((next) => {
    setBounds(next);
  }, []);
  const resize = useResizable({
    bounds,
    minSize,
    onPreview: previewPanelResize,
    onCommit: commitPanelResize
  });
  useLayoutEffect(() => {
    if (!resize.resizing) {
      setBoundsStyle(panelRef.current, bounds);
    }
  }, [bounds, resize.resizing]);
  useEffect(() => {
    const keepInViewport = () => {
      const viewport = getViewportSize();
      setBounds((current) => clampBounds(current, minSize, viewport));
      setPetPosition((current) => clampPoint(current, PET_SIZE, viewport));
    };
    window.addEventListener("resize", keepInViewport);
    return () => window.removeEventListener("resize", keepInViewport);
  }, [minSize]);
  return {
    open,
    bounds,
    panelRef,
    petPosition,
    petRef,
    panelDrag,
    petDrag,
    resize,
    close: () => setOpen(false),
    openPanel: () => setOpen(true)
  };
}
function setTranslation(element, x2, y2) {
  if (element) {
    element.style.transform = `translate3d(${x2}px, ${y2}px, 0)`;
  }
}
function setBoundsStyle(element, bounds) {
  if (!element) {
    return;
  }
  element.style.width = `${bounds.width}px`;
  element.style.height = `${bounds.height}px`;
  setTranslation(element, bounds.x, bounds.y);
}
function ShellWindow({
  children,
  state,
  title
}) {
  const window2 = useWindow();
  return /* @__PURE__ */ jsxs(Fragment, { children: [
    /* @__PURE__ */ jsx(
      FloatingPanel,
      {
        bounds: window2.bounds,
        dragging: window2.panelDrag.dragging,
        elementRef: window2.panelRef,
        open: window2.open,
        resizing: window2.resize.resizing,
        state,
        title,
        dragProps: window2.panelDrag.getDragProps,
        getResizeProps: window2.resize.getResizeProps,
        onClose: window2.close,
        children
      }
    ),
    /* @__PURE__ */ jsx(
      AssistantPet,
      {
        dragging: window2.petDrag.dragging,
        elementRef: window2.petRef,
        open: window2.open,
        position: window2.petPosition,
        dragProps: window2.petDrag.getDragProps,
        consumeDraggedClick: window2.petDrag.consumeDraggedClick,
        onOpen: window2.openPanel
      }
    )
  ] });
}
const AGENT_TITLE = "智能向导";
const AGENT_ENTRY_PATH = "/agent/entry";
function AgentShell({ serverUrl }) {
  const entryUrl = new URL(AGENT_ENTRY_PATH, serverUrl).toString();
  const frame = useAgentFrame(entryUrl);
  useGuide(frame.ref);
  return /* @__PURE__ */ jsx("div", { className: "pando-agent-shell", children: /* @__PURE__ */ jsx(ShellWindow, { state: frame.state, title: AGENT_TITLE, children: /* @__PURE__ */ jsx(
    AgentPanel,
    {
      entryUrl,
      frame,
      title: AGENT_TITLE
    }
  ) }) });
}
export {
  AgentShell
};
