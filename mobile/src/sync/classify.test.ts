import { ApiError } from "@jobproof/shared";
import { classify, VERDICT_MSG, type Verdict } from "./classify";

const err = (status: number, code: string, extra: Partial<ConstructorParameters<typeof ApiError>[0]> = {}) => new ApiError({ status, code, title: code, ...extra });

/** The whole table of design 3.4, row by row, including the rows later tickets use. */
const TABLE: [string, unknown, Verdict][] = [
  ["a network error", err(0, "network_error"), { kind: "retry", offline: true }],
  ["a timeout", err(0, "timeout"), { kind: "retry", offline: true }],
  ["something that is not an API error", new TypeError("boom"), { kind: "retry", offline: true }],
  ["500", err(500, "internal_error"), { kind: "retry", offline: false }],
  ["502", err(502, "http_error"), { kind: "retry", offline: false }],
  ["429 with Retry-After", err(429, "http_error", { retryAfterSeconds: 30 }), { kind: "retry", offline: false, retryAfterSeconds: 30 }],
  ["503 busy with Retry-After", err(503, "busy", { retryAfterSeconds: 5 }), { kind: "retry", offline: false, retryAfterSeconds: 5 }],
  ["401 session_ended", err(401, "session_ended"), { kind: "session_ended", code: "session_ended" }],
  ["401 account_inactive", err(401, "account_inactive"), { kind: "session_ended", code: "account_inactive" }],
  ["401 unauthenticated", err(401, "unauthenticated"), { kind: "session_ended", code: "session_ended" }],
  ["426 app_update_required", err(426, "app_update_required"), { kind: "update_required" }],
  ["404 on a job or photo", err(404, "not_found"), { kind: "needs_attention", code: "job_changed", message: "This job was changed by the office. Contact the office." }],
  ["409 job_cancelled", err(409, "job_cancelled"), { kind: "needs_attention", code: "job_cancelled", message: VERDICT_MSG.cancelled }],
  ["409 job_closed", err(409, "job_closed"), { kind: "needs_attention", code: "job_closed", message: "The office has already closed this job." }],
  ["409 draft_owned_by_other", err(409, "draft_owned_by_other"), { kind: "needs_attention", code: "draft_owned_by_other", message: VERDICT_MSG.ownedByOther }],
  ["409 photo_limit_reached", err(409, "photo_limit_reached"), { kind: "needs_attention", code: "photo_limit_reached", message: VERDICT_MSG.photoLimit }],
  ["409 already_submitted", err(409, "already_submitted"), { kind: "check_submission" }],
  ["409 photos_not_registered", err(409, "photos_not_registered", { problem: { missing_photo_ids: ["p1", "p2"] } }), { kind: "register_missing", photoIds: ["p1", "p2"] }],
  ["409 photos_not_registered with no ids", err(409, "photos_not_registered"), { kind: "register_missing", photoIds: [] }],
  ["409 report_submitted", err(409, "report_submitted"), { kind: "report_submitted", message: "Not sent: report already submitted" }],
  ["409 photo_content_mismatch", err(409, "photo_content_mismatch"), { kind: "photo_failed", code: "photo_content_mismatch", message: VERDICT_MSG.mismatch }],
  ["409 duplicate_photo", err(409, "duplicate_photo"), { kind: "duplicate_photo", message: "This photo is already on this job." }],
  ["409 with a code nobody knows", err(409, "something_new"), { kind: "needs_attention", code: "something_new", message: VERDICT_MSG.refused }],
  ["413", err(413, "photo_too_large"), { kind: "photo_failed", code: "photo_too_large", message: "Couldn't be sent: file too large" }],
  ["415", err(415, "unsupported_photo_type"), { kind: "photo_failed", code: "unsupported_photo_type", message: "Couldn't be sent: not a photo" }],
  ["422 checksum_mismatch", err(422, "checksum_mismatch"), { kind: "retry_checksum" }],
  [
    "422 submission_incomplete",
    err(422, "submission_incomplete", { fieldErrors: [{ loc: [], message: "Add an after photo." }, { loc: [], message: "" }] }),
    { kind: "back_to_draft", reasons: ["Add an after photo."] },
  ],
  ["422 validation_error", err(422, "validation_error"), { kind: "needs_attention", code: "validation_error", message: VERDICT_MSG.refused }],
  ["403", err(403, "forbidden"), { kind: "needs_attention", code: "forbidden", message: VERDICT_MSG.refused }],
  ["another 4xx", err(400, "http_error"), { kind: "needs_attention", code: "http_error", message: VERDICT_MSG.refused }],
];

describe("classify (design 3.4 error table)", () => {
  it.each(TABLE)("%s", (_name, error, verdict) => {
    expect(classify(error)).toEqual(verdict);
  });

  it("never treats a lost connection or a server problem as permanent (the work is kept and retried)", () => {
    for (const status of [0, 500, 502, 503, 504, 429]) expect(classify(err(status, "x")).kind).toBe("retry");
  });
});
