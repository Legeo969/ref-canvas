import { fileURLToPath } from "node:url";
import path from "node:path";

export interface ProtocolOriginPolicyOptions {
  allowedOrigins: string[];
  allowedReferrerPrefixes: string[];
}

export interface ProtocolRequestDecision {
  allowed: boolean;
  corsOrigin?: string;
}

function parseUrl(value: string): URL | null {
  try {
    const parsed = new URL(value);
    if (parsed.username || parsed.password) return null;
    return parsed;
  } catch {
    return null;
  }
}

function normalizedOrigin(value: string): string | null {
  const parsed = parseUrl(value);
  return parsed && parsed.origin !== "null" ? parsed.origin : null;
}

function containsRawTraversal(value: string): boolean {
  const pathPart = value.split(/[?#]/, 1)[0];
  try {
    return decodeURIComponent(pathPart)
      .split(/[\\/]/)
      .some((segment) => segment === "." || segment === "..");
  } catch {
    return true;
  }
}

function fileReferrerAllowed(
  rawReferrer: string,
  parsed: URL,
  options: ProtocolOriginPolicyOptions,
): boolean {
  if (containsRawTraversal(rawReferrer)) return false;
  let filename: string;
  try {
    filename = path.resolve(fileURLToPath(parsed));
  } catch {
    return false;
  }
  return options.allowedReferrerPrefixes.some((prefix) => {
    const rootUrl = parseUrl(prefix);
    if (!rootUrl || rootUrl.protocol !== "file:" || containsRawTraversal(prefix)) return false;
    try {
      const root = path.resolve(fileURLToPath(rootUrl));
      const relative = path.relative(root, filename);
      return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
    } catch {
      return false;
    }
  });
}

function referrerDecision(
  referrer: string,
  options: ProtocolOriginPolicyOptions,
): { allowed: boolean; origin: string | null; file: boolean } {
  const parsed = parseUrl(referrer);
  if (!parsed) return { allowed: false, origin: null, file: false };
  if (parsed.protocol === "file:") {
    return {
      allowed: fileReferrerAllowed(referrer, parsed, options),
      origin: null,
      file: true,
    };
  }
  const origin = parsed.origin;
  const allowed = options.allowedOrigins.some((candidate) => normalizedOrigin(candidate) === origin);
  return { allowed, origin, file: false };
}

/** Missing provenance is allowed for Chromium's direct custom-scheme image loads, without CORS. */
export function evaluateProtocolRequest(
  request: Pick<Request, "headers"> & Partial<Pick<Request, "referrer">>,
  options: ProtocolOriginPolicyOptions,
): ProtocolRequestDecision {
  const originHeader = request.headers.get("origin");
  const referrer = request.headers.get("referer")
    ?? request.headers.get("referrer")
    ?? request.referrer
    ?? null;

  const origin = originHeader === null
    ? null
    : originHeader === "null"
      ? "null"
      : normalizedOrigin(originHeader);
  if (originHeader !== null && origin === null) return { allowed: false };

  const ref = referrer ? referrerDecision(referrer, options) : null;
  if (ref && !ref.allowed) return { allowed: false };

  if (origin !== null) {
    if (origin === "null") {
      if (!ref?.file) return { allowed: false };
      return { allowed: true, corsOrigin: "null" };
    }
    const originAllowed = options.allowedOrigins.some(
      (candidate) => normalizedOrigin(candidate) === origin,
    );
    if (!originAllowed) return { allowed: false };
    // When both values exist they must describe the same trusted origin.
    if (ref && (ref.file || ref.origin !== origin)) return { allowed: false };
    return { allowed: true, corsOrigin: origin };
  }

  if (ref) {
    return ref.origin
      ? { allowed: true, corsOrigin: ref.origin }
      : { allowed: true };
  }
  return { allowed: true };
}

export function protocolResponseHeaders(
  decision: ProtocolRequestDecision,
  contentType?: string,
): Record<string, string> {
  return {
    ...(contentType ? { "Content-Type": contentType } : {}),
    ...(decision.corsOrigin ? { "Access-Control-Allow-Origin": decision.corsOrigin } : {}),
    "Cross-Origin-Resource-Policy": "cross-origin",
    Vary: "Origin, Referer",
  };
}
