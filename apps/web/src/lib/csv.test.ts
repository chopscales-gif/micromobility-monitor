import { describe, expect, it } from "vitest";
import { toCsv } from "./csv";

describe("CSV export", () => {
  it("quotes commas, quotes and line breaks", () => {
    expect(toCsv([["a,b", 'say "hi"', "two\nlines"]])).toBe('"a,b","say ""hi""","two\nlines"\r\n');
  });

  it("stops a spreadsheet from running feed text as a formula", () => {
    expect(toCsv([["=HYPERLINK(1)", "+1", "@x", "-2"]])).toBe("'=HYPERLINK(1),'+1,'@x,'-2\r\n");
  });

  it("leaves real numbers alone, including negative ones", () => {
    expect(toCsv([[-609, 12.5, null]])).toBe("-609,12.5,\r\n");
  });
});
