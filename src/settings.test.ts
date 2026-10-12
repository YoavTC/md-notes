import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, formatDate } from "./settings";

// 3 Feb 2026, 09:05:07 local time.
const t = new Date(2026, 1, 3, 9, 5, 7).getTime();
const pm = new Date(2026, 11, 25, 21, 0, 0).getTime();

describe("formatDate", () => {
  it("uses DD/MM/YYYY HH:mm:ss by default", () => {
    expect(formatDate(t, DEFAULT_SETTINGS.dateFormat)).toBe("03/02/2026 09:05:07");
  });

  it("supports short, 12-hour and literal tokens", () => {
    expect(formatDate(t, "D.M.YY H:mm")).toBe("3.2.26 9:05");
    expect(formatDate(pm, "hh:mm A [on] YYYY-MM-DD")).toBe("09:00 PM on 2026-12-25");
    expect(formatDate(pm, "h a")).toBe("9 pm");
  });

  it("prints bracketed text and punctuation literally", () => {
    expect(formatDate(t, "[Created] DD/MM — ss")).toBe("Created 03/02 — 07");
  });
});
