import { ApiError } from "@jobproof/shared";
import { MSG } from "./messages";
import { mapSignInError } from "./signInErrors";
import { unsentMessage, unsentTotal } from "./unsent";

const err = (status: number, code: string) => new ApiError({ status, code, title: code });

describe("mapSignInError (scenarios 2, 3, 12 and the rate limit)", () => {
  it("maps every failure to the ticket wording", () => {
    expect(mapSignInError(err(401, "invalid_credentials"))).toEqual({ message: "Email or password is incorrect.", clearPassword: true });
    expect(mapSignInError(err(403, "operatives_only"))).toEqual({
      message: "This app is for operatives. Managers use the web app.",
      clearPassword: true,
    });
    expect(mapSignInError(err(0, "network_error"))).toEqual({ message: "No signal. Sign in needs a connection.", clearPassword: false });
    expect(mapSignInError(err(0, "timeout")).message).toBe(MSG.noSignal);
    expect(mapSignInError(err(429, "rate_limited")).message).toBe(MSG.rateLimited);
    expect(mapSignInError(err(403, "http_error")).message).toBe(MSG.rateLimited); // bare 403 from the WAF
    expect(mapSignInError(err(426, "app_update_required")).message).toBe(MSG.updateRequired);
    expect(mapSignInError(err(500, "boom")).message).toBe(MSG.unexpected);
    expect(mapSignInError(new Error("x")).message).toBe(MSG.unexpected);
  });
});

describe("unsentMessage (scenario 9)", () => {
  it("says 4 photos exactly as the ticket does", () => {
    expect(unsentMessage({ photos: 4, reports: 0 })).toBe("4 photos haven't reached the office yet. Stay signed in so they can send.");
  });
  it("singular, reports and mixes", () => {
    expect(unsentMessage({ photos: 1, reports: 0 })).toBe("1 photo hasn't reached the office yet. Stay signed in so it can send.");
    expect(unsentMessage({ photos: 0, reports: 2 })).toBe("2 reports haven't reached the office yet. Stay signed in so they can send.");
    expect(unsentMessage({ photos: 3, reports: 1 })).toBe("3 photos and 1 report haven't reached the office yet. Stay signed in so they can send.");
  });
  it("total", () => expect(unsentTotal({ photos: 3, reports: 1 })).toBe(4));
});
