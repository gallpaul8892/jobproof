export interface FieldError {
  loc: (string | number)[];
  message: string;
  measured_ratio?: number;
  required_ratio?: number;
}

/** Normalised API failure: RFC 9457 problem responses and network/timeout failures. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly title: string;
  readonly detail: string | undefined;
  readonly requestId: string | undefined;
  readonly fieldErrors: FieldError[];
  /** The parsed problem body, so callers can read extension members. */
  readonly problem: Record<string, unknown> | undefined;

  constructor(init: {
    status: number;
    code: string;
    title: string;
    detail?: string;
    requestId?: string;
    fieldErrors?: FieldError[];
    problem?: Record<string, unknown>;
  }) {
    super(init.detail ?? init.title);
    this.name = "ApiError";
    this.status = init.status;
    this.code = init.code;
    this.title = init.title;
    this.detail = init.detail;
    this.requestId = init.requestId;
    this.fieldErrors = init.fieldErrors ?? [];
    this.problem = init.problem;
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

/** Builds an ApiError from a parsed error body (problem+json or anything else) and status. */
export function toApiError(body: unknown, status: number, headerRequestId?: string | null): ApiError {
  if (isRecord(body)) {
    const errors = Array.isArray(body.errors) ? body.errors : [];
    return new ApiError({
      status,
      code: typeof body.code === "string" ? body.code : "http_error",
      title: typeof body.title === "string" ? body.title : `HTTP ${status}`,
      detail: typeof body.detail === "string" ? body.detail : undefined,
      requestId:
        typeof body.request_id === "string" ? body.request_id : (headerRequestId ?? undefined),
      fieldErrors: errors.filter(isRecord).map((e) => ({
        loc: Array.isArray(e.loc) ? (e.loc as (string | number)[]) : [],
        message: String(e.message ?? ""),
        ...(typeof e.measured_ratio === "number" ? { measured_ratio: e.measured_ratio } : {}),
        ...(typeof e.required_ratio === "number" ? { required_ratio: e.required_ratio } : {}),
      })),
      problem: body,
    });
  }
  return new ApiError({
    status,
    code: status === 503 ? "unavailable" : "http_error",
    title: `HTTP ${status}`,
    requestId: headerRequestId ?? undefined,
  });
}

export function networkError(cause: unknown): ApiError {
  const timedOut = cause instanceof DOMException && cause.name === "TimeoutError";
  return new ApiError({
    status: 0,
    code: timedOut ? "timeout" : "network_error",
    title: timedOut ? "The request timed out" : "Cannot reach the API",
  });
}
