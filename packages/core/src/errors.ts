/** Typed errors shared across the registry, router, and billing layers. */
export type AppErrorCode =
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "validation"
  | "insufficient_credits"
  | "connector_unavailable"
  | "tunnel_not_implemented"
  | "protocol_unsupported"
  | "upstream_error"
  | "rate_limited"
  | "internal";

const STATUS: Record<AppErrorCode, number> = {
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  validation: 422,
  insufficient_credits: 402,
  connector_unavailable: 503,
  tunnel_not_implemented: 501,
  protocol_unsupported: 400,
  upstream_error: 502,
  rate_limited: 429,
  internal: 500,
};

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: AppErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = STATUS[code];
    this.details = details;
  }

  toJSON() {
    return { error: { code: this.code, message: this.message, details: this.details } };
  }
}

export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError;
}
