import { useEffect, useRef } from "react";

/**
 * 返回一个引用永远稳定的回调：内部总是调用最新的闭包，但返回值本身不随
 * 每次渲染变化。用于把 memo 化的子组件（如目录卡片）回调 props 稳定化，
 * 避免父组件每次渲染时传入新引用导致 memo 浅比较失效、子组件全量重建。
 */
export function useStableCallback<T extends (...args: never[]) => unknown>(
  callback: T,
): T {
  const ref = useRef(callback);
  useEffect(() => {
    ref.current = callback;
  }, [callback]);
  const stable = useRef((...args: never[]) => (ref.current as T)(...args));
  return stable.current as T;
}
