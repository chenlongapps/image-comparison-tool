import { useEffect, useRef, useState } from 'react';

/**
 * 抗闪烁 loading 可见性参数
 */
interface LoadingVisibilityOptions {
  /** loading 持续多久后才显示提示，避免短任务的闪退（毫秒） */
  showDelay?: number;
  /** 提示一旦显示，至少保持多久，避免被快速取消造成闪烁（毫秒） */
  minVisible?: number;
}

const DEFAULT_SHOW_DELAY = 200;
const DEFAULT_MIN_VISIBLE = 400;

/**
 * 把真实 loading 状态转换为“稳定可见”的提示状态
 *
 * 背景：媒体面板的解码/解析常在几十毫秒内完成，loading 状态快速 true → false
 * 会让“正在处理”遮罩反复挂载与卸载，视觉上就是屏幕闪烁。
 *
 * 规则：
 * - loading 变 true 后延迟 showDelay 才显示，中途 loading 结束则直接取消；
 * - 提示已经显示后，至少保持 minVisible，期间反复横跳也不会闪烁；
 * - 组件卸载时清理所有定时器。
 */
export function useLoadingVisibility(
  loading: boolean,
  options: LoadingVisibilityOptions = {}
): boolean {
  const { showDelay = DEFAULT_SHOW_DELAY, minVisible = DEFAULT_MIN_VISIBLE } = options;

  const [visible, setVisible] = useState(false);
  // 用 ref 缓存可见状态，便于在副作用中同步判断，避免依赖 visible 造成重复执行。
  const visibleRef = useRef(false);
  const shownAtRef = useRef(0);
  const showTimerRef = useRef<number | null>(null);
  const hideTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const clearShowTimer = () => {
      if (showTimerRef.current !== null) {
        window.clearTimeout(showTimerRef.current);
        showTimerRef.current = null;
      }
    };
    const clearHideTimer = () => {
      if (hideTimerRef.current !== null) {
        window.clearTimeout(hideTimerRef.current);
        hideTimerRef.current = null;
      }
    };

    if (loading) {
      // loading 再次为 true 时取消待执行的隐藏，避免遮罩中途消失。
      clearHideTimer();
      // 尚未展示时才启动延迟计时，重复的 loading 变化不会叠加定时器。
      if (!visibleRef.current && showTimerRef.current === null) {
        showTimerRef.current = window.setTimeout(() => {
          showTimerRef.current = null;
          shownAtRef.current = performance.now();
          visibleRef.current = true;
          setVisible(true);
        }, showDelay);
      }
      return;
    }

    // loading 结束但还没到展示时间：直接取消，用户完全感知不到。
    clearShowTimer();

    if (!visibleRef.current) {
      return;
    }

    // 已展示的任务补足最短展示时长，避免遮罩刚出现就消失造成的闪烁。
    const remaining = minVisible - (performance.now() - shownAtRef.current);
    if (remaining <= 0) {
      visibleRef.current = false;
      setVisible(false);
      return;
    }
    if (hideTimerRef.current === null) {
      hideTimerRef.current = window.setTimeout(() => {
        hideTimerRef.current = null;
        visibleRef.current = false;
        setVisible(false);
      }, remaining);
    }
  }, [loading, showDelay, minVisible]);

  // 卸载时清理定时器，防止离开面板后仍触发状态更新。
  useEffect(() => {
    const showTimer = showTimerRef;
    const hideTimer = hideTimerRef;
    return () => {
      if (showTimer.current !== null) { window.clearTimeout(showTimer.current); }
      if (hideTimer.current !== null) { window.clearTimeout(hideTimer.current); }
    };
  }, []);

  return visible;
}
