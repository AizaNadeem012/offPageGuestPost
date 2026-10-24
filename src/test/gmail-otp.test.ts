import { describe, expect, it } from "vitest";
import { extractUniqueOtp } from "@/lib/gmail-oauth.server";

describe("Gmail OTP extraction", () => {
  it("extracts a code near verification wording", () => {
    expect(extractUniqueOtp("Your verification code is 482913 and expires soon.")).toBe("482913");
  });

  it("does not guess when there are multiple candidate codes", () => {
    expect(extractUniqueOtp("Your OTP is 482913. Backup code: 119204.")).toBeNull();
  });

  it("ignores unrelated numbers without OTP wording", () => {
    expect(extractUniqueOtp("Order 482913 was created in 2026.")).toBeNull();
  });
});
