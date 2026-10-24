import { describe, expect, it } from "vitest";
import { getSubmissionFeeSignal } from "@/lib/web.server";

describe("guest-post submission fee signal", () => {
  it("flags an explicit free guest-post statement as a candidate signal", () => {
    expect(getSubmissionFeeSignal("We accept free guest posts from contributors.")).toBe(
      "explicitly_free",
    );
  });

  it("flags fee mentions for manual review", () => {
    expect(getSubmissionFeeSignal("Guest post publishing fee applies.")).toBe("fee_mentioned");
  });

  it("does not infer free submission when guidelines are silent", () => {
    expect(getSubmissionFeeSignal("We welcome original articles from writers.")).toBe("unclear");
  });
});
