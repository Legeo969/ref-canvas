import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export type PreviewLoadStatus = "idle" | "loading" | "waiting" | "ready" | "failed";

export const PREVIEW_RETRY_DELAYS_MS = [600, 1_200, 2_400, 4_800] as const;
/** DCC 资产（Blender 渲染缩略图慢、滚动 abort 频繁）：给更长的重试窗口，
 * 避免滚动浏览时缩略图被快速判死「不见」。 */
export const PREVIEW_RETRY_DELAYS_DCC_MS = [
  800, 1_600, 3_200, 6_400, 10_000, 15_000, 20_000, 25_000,
] as const;

/** 单次请求的 stall 超时：主进程解码/队列异常时，请求既不会 load 也不会
 * error（例如 worker 卡死占住队列槽）。超过该时长仍无结果即按失败处理，
 * 走既有重试/失败收敛，保证卡片不会永远停在「正在生成预览」。 */
export const PREVIEW_ATTEMPT_TIMEOUT_MS = 60_000;
export const PREVIEW_ATTEMPT_TIMEOUT_DCC_MS = 120_000;

export function previewUrlWithRetry(source: string, nonce: number): string {
  if (nonce <= 0) return source;
  return `${source}${source.includes("?") ? "&" : "?"}previewRetry=${nonce}`;
}

/**
 * Browser media requests are allowed to fail while an expensive cache proxy is
 * still being generated. Retry the same cache identity with a renderer-only
 * nonce so a completed proxy is picked up without reselecting the asset.
 */
export function useRetryingPreviewUrl(
  source: string | null,
  options?: { dccSlowAsset?: boolean },
) {
  const delays = options?.dccSlowAsset
    ? PREVIEW_RETRY_DELAYS_DCC_MS
    : PREVIEW_RETRY_DELAYS_MS;
  const stallTimeoutMs = options?.dccSlowAsset
    ? PREVIEW_ATTEMPT_TIMEOUT_DCC_MS
    : PREVIEW_ATTEMPT_TIMEOUT_MS;
  const timerRef = useRef<number | null>(null);
  const stallTimerRef = useRef<number | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [nonce, setNonce] = useState(0);
  const [status, setStatus] = useState<PreviewLoadStatus>(
    source ? "loading" : "idle",
  );

  const clearRetry = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const clearStall = useCallback(() => {
    if (stallTimerRef.current !== null) {
      window.clearTimeout(stallTimerRef.current);
      stallTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    clearRetry();
    clearStall();
    setAttempt(0);
    setNonce(0);
    setStatus(source ? "loading" : "idle");
    return () => {
      clearRetry();
      clearStall();
    };
  }, [clearRetry, clearStall, source]);

  const markReady = useCallback(() => {
    clearRetry();
    clearStall();
    setStatus("ready");
  }, [clearRetry, clearStall]);

  const markError = useCallback(() => {
    clearRetry();
    clearStall();
    if (!source) {
      setStatus("idle");
      return;
    }
    if (attempt >= delays.length) {
      setStatus("failed");
      return;
    }
    setStatus("waiting");
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      setAttempt((value) => value + 1);
      setNonce((value) => value + 1);
      setStatus("loading");
    }, delays[attempt]);
  }, [attempt, clearRetry, clearStall, delays, source]);

  const retry = useCallback(() => {
    if (!source) return;
    clearRetry();
    clearStall();
    setAttempt(0);
    setNonce((value) => value + 1);
    setStatus("loading");
  }, [clearRetry, clearStall, source]);

  const url = useMemo(
    () => (source ? previewUrlWithRetry(source, nonce) : null),
    [nonce, source],
  );

  // 每次进入 loading（url 随 nonce 变化）时武装 stall 超时。请求挂起
  // （主进程 worker 卡死等）时强制 markError → 重试/失败，保证收敛。
  const markErrorRef = useRef(markError);
  markErrorRef.current = markError;
  useEffect(() => {
    if (status !== "loading" || !url) return;
    clearStall();
    stallTimerRef.current = window.setTimeout(() => {
      stallTimerRef.current = null;
      markErrorRef.current();
    }, stallTimeoutMs);
    return clearStall;
  }, [clearStall, status, stallTimeoutMs, url]);

  return {
    url,
    status,
    attempt,
    markReady,
    markError,
    retry,
  };
}
