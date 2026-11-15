import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DEMO_BANNER_TEXT, DemoBanner } from "./index";
import { wrap, renderPlaceholderSvg } from "./photoSvg";

describe("DemoBanner", () => {
  it("shows the persistent demo notice and makes room for it", () => {
    const { unmount } = render(<DemoBanner />);
    expect(screen.getByTestId("demo-banner").textContent).toBe(DEMO_BANNER_TEXT);
    expect(DEMO_BANNER_TEXT).toBe("Demo with sample data. Nothing is saved.");
    expect(document.body.classList.contains("has-demo-banner")).toBe(true);
    unmount();
    expect(document.body.classList.contains("has-demo-banner")).toBe(false);
  });
});

describe("placeholder photos", () => {
  it("wraps text and breaks long words", () => {
    expect(wrap("aaa bbb ccc", 7)).toEqual(["aaa bbb", "ccc"]);
    expect(wrap("abcdefghij", 4)).toEqual(["abcd", "efgh", "ij"]);
    expect(wrap("", 4)).toEqual([]);
  });

  it("renders a safe SVG with the reference, stage and escaped caption", () => {
    const svg = renderPlaceholderSvg(
      { id: "11757f84-28a7-5bf8-b306-3419320bd436", stage: "after", caption: "Done <b>&", taken_at: "2026-05-21T07:36:00Z", width: 1600, height: 1200 },
      "JP-1001",
      "thumb",
    );
    expect(svg).toContain('width="400" height="300" viewBox="0 0 1600 1200"');
    expect(svg).toContain("JP-1001 · After");
    expect(svg).toContain("Done &lt;b&gt;&amp;");
    expect(svg).toContain("21 May 2026, 08:36");
    expect(svg).not.toContain("<b>");
  });
});
