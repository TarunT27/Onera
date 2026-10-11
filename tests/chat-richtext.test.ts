import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RichText } from "../app/chat/RichText";

const html = (text: string) => renderToStaticMarkup(createElement(RichText, { text }));

describe("assistant reply formatting", () => {
  it("renders paragraphs, bold, code and lists", () => {
    expect(html("Hello **there**.\n\nUse `act_1`.")).toBe("<p>Hello <strong>there</strong>.</p><p>Use <code>act_1</code>.</p>");
    expect(html("**Top:**\n- Groceries\n- Dining")).toBe("<p><strong>Top:</strong></p><ul><li>Groceries</li><li>Dining</li></ul>");
    expect(html("1. One\n2. Two")).toBe("<ol><li>One</li><li>Two</li></ol>");
    expect(html("### Summary\nline two")).toBe("<p><strong>Summary</strong><br/>line two</p>");
  });

  it("never turns reply text into HTML", () => {
    const out = html('<img src=x onerror="alert(1)"> **<script>x</script>**');
    expect(out).not.toContain("<img");
    expect(out).not.toContain("<script");
    expect(out).toContain("&lt;img");
  });
});
