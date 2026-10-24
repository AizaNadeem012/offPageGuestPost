import { describe, expect, it } from "vitest";
import {
  getManualArticleError,
  parseCampaignBrief,
  parseManualArticle,
  parseRows,
} from "@/lib/guestpilot";

describe("manual campaign content", () => {
  it("reads labeled campaign details without an AI provider", () => {
    expect(
      parseCampaignBrief(
        "Business Name: Acme\nWebsite: https://acme.example\nKeywords: seo, publishing\nTarget URLs: https://acme.example/page\nAnchor Texts: helpful guide",
      ),
    ).toMatchObject({
      businessName: "Acme",
      website: "https://acme.example",
      keywords: ["seo", "publishing"],
      targetUrls: ["https://acme.example/page"],
      anchorTexts: ["helpful guide"],
    });
  });

  it("reads the shared article from the prompt", () => {
    const prompt = [
      "Business Name: Acme",
      "Website: https://acme.example",
      "Target URLs: https://acme.example/page",
      "Article Title: A helpful article",
      "Article Content:",
      "First paragraph of the article.",
      "",
      "Second paragraph with more detail.",
      "End Article",
    ].join("\n");

    expect(parseCampaignBrief(prompt)).toMatchObject({
      businessName: "Acme",
      website: "https://acme.example",
      targetUrls: ["https://acme.example/page"],
    });
    expect(parseManualArticle(prompt)).toEqual({
      title: "A helpful article",
      content: "First paragraph of the article.\n\nSecond paragraph with more detail.",
    });
    expect(getManualArticleError(parseManualArticle(prompt))).toBeNull();
  });

  it("accepts article text immediately after the title without an Article Content label", () => {
    expect(
      parseManualArticle(
        "Business Name: Acme\nArticle Title: A helpful article\nThis is the full article text.",
      ),
    ).toEqual({
      title: "A helpful article",
      content: "This is the full article text.",
    });
  });

  it("uses general prompt text as a draft without requiring article labels", () => {
    const prompt = "My business provides helpful solar installation services.";
    const article = parseManualArticle(prompt);

    expect(article).toEqual({ title: "Guest post draft", content: prompt });
    expect(getManualArticleError(article)).toBeNull();
  });

  it("allows a title without a separate article-content field", () => {
    const prompt = "Article Title: My topic";

    expect(parseManualArticle(prompt)).toEqual({
      title: "My topic",
      content: prompt,
    });
    expect(getManualArticleError(parseManualArticle(prompt))).toBeNull();
  });

  it("uses the prompt text when an optional content label has no text after it", () => {
    const prompt = "Article Title: My topic\nArticle Content:";
    expect(parseManualArticle(prompt)).toEqual({
      title: "My topic",
      content: prompt,
    });
  });

  it("only asks for some text when the prompt is blank", () => {
    expect(getManualArticleError(parseManualArticle("  "))).toBe(
      "Prompt mein apna business ya article ka kuch text likhein.",
    );
  });

  it("imports a URL-only spreadsheet", () => {
    const result = parseRows([{ Website: "example.com" }, { Website: "second.example" }]);

    expect(result.rows.map((row) => row.url)).toEqual([
      "https://example.com",
      "https://second.example",
    ]);
    expect(result.issues).toEqual([]);
  });
});
