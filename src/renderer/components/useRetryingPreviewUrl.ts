import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export type PreviewLoadStatus = "idle" | "loading" | "waiting" | "ready" | "failed";

export const PREVIEW_RETRY_DELAYS_MS = [600, 1_200, 2_400, 4_800] as const;

export function previewUrlWithRetry(source: string, nonce: number): string {
  if (nonce <= 0) return source;
  return `${source}${source.includes("?") ? "&" : "?"}previewRetry=${nonce}`;
}

/**
 * Browser media requests are allowed to fail while an expensive cache proxy is
 * still being generated. Retry the same cache identity with a renderer-only
 * nonce so a completed proxy is picked up without reselecting the asset.
 */
export function useRetryingPreviewUrl(source: string | null) {
  const timerRef = useRef<number | null>(null);
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

  useEffect(() => {
    clearRetry();
    setAttempt(0);
    setNonce(0);
    setStatus(source ? "loading" : "idle");
    return clearRetry;
  }, [clearRetry, source]);

  const markReady = useCallback(() => {
    clearRetry();
    setStatus("ready");
  }, [clearRetry]);

  const markError = useCallback(() => {
    clearRetry();
    if (!source) {
      setStatus("idle");
      return;
    }
    if (attempt >= PREVIEW_RETRY_DELAYS_MS.length) {
      setStatus("failed");
      return;
    }
    setStatus("waiting");
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      setAttempt((value) => value + 1);
      setNonce((value) => value + 1);
      setStatus("loading");
    }, PREVIEW_RETRY_DELAYS_MS[attempt]);
  }, [attempt, clearRetry, source]);

  const retry = useCallback(() => {
    if (!source) return;
    clearRetry();
    setAttempt(0);
    setNonce((value) => value + 1);
    setStatus("loading");
  }, [clearRetry, source]);

  const url = useMemo(
    () => (source ? previewUrlWithRetry(source, nonce) : null),
    [nonce, source],
  );

  return {
    url,
    status,
    attempt,
    markReady,
    markError,
    retry,
  };
}
