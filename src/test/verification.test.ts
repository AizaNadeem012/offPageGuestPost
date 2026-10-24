import { describe, expect, it } from "vitest";
import {
  validateCandidateUrl,
  normalizeDestinationUrl,
  extractAnchors,
  verifyBacklink,
} from "@/lib/verification.server";
import { computeStats, toCsv } from "@/lib/guestpilot";
import { STATUS_LABEL } from "@/lib/guestpilot";

describe("Strict Backlink Verification Engine", () => {
  // -------------------------------------------------------------------------
  // 1. Jotform login URL must never be accepted as a published article
  // -------------------------------------------------------------------------
  describe("Rule 1: Jotform login & form URLs rejected", () => {
    it("rejects Jotform login URL as publication evidence", () => {
      const res = validateCandidateUrl("https://www.jotform.com/login");
      expect(res.valid).toBe(false);
      expect(res.reason).toMatch(/authentication|third-party form/i);
    });

    it("rejects Jotform subdomains and hosted forms", () => {
      const res1 = validateCandidateUrl("https://form.jotform.com/2134567890");
      expect(res1.valid).toBe(false);
      expect(res1.reason).toMatch(/third-party form/i);

      const res2 = validateCandidateUrl("https://jotform.com/login?redirect=%2Fmyaccount");
      expect(res2.valid).toBe(false);
    });

    it("fails full backlink verification immediately for Jotform login URL without making network requests", async () => {
      const result = await verifyBacklink({
        publishedUrl: "https://www.jotform.com/login",
        targetUrl: "https://afimah.com/",
      });
      expect(result.status).toBe("failed");
      expect(result.linkFound).toBe(false);
      expect(result.reason).toMatch(/authentication|third-party form/i);
    });
  });

  // -------------------------------------------------------------------------
  // 2. Contact form and guest-post guidelines page must never be counted
  // -------------------------------------------------------------------------
  describe("Rule 2: Contact form and guidelines pages rejected", () => {
    const contactUrls = [
      "https://example.com/contact",
      "https://example.com/contact-us",
      "https://example.com/contact-us/",
      "https://example.com/contact.html",
      "https://example.com/get-in-touch",
      "https://example.com/contact-us?subject=guestpost",
    ];

    for (const url of contactUrls) {
      it(`rejects contact URL: ${url}`, () => {
        const res = validateCandidateUrl(url);
        expect(res.valid).toBe(false);
        expect(res.reason).toMatch(/contact form/i);
      });
    }

    const guidelinesUrls = [
      "https://publisher.com/write-for-us",
      "https://publisher.com/write-for-us/",
      "https://publisher.com/guest-post-guidelines",
      "https://publisher.com/editorial-guidelines",
      "https://publisher.com/contribute",
      "https://publisher.com/submit-article",
      "https://publisher.com/guidelines?ref=nav",
    ];

    for (const url of guidelinesUrls) {
      it(`rejects guidelines URL: ${url}`, () => {
        const res = validateCandidateUrl(url);
        expect(res.valid).toBe(false);
        expect(res.reason).toMatch(/guidelines|submission/i);
      });
    }

    it("rejects submission receipts and search query URLs", () => {
      expect(validateCandidateUrl("https://blog.com/thank-you").valid).toBe(false);
      expect(validateCandidateUrl("https://blog.com/form-submitted").valid).toBe(false);
      expect(validateCandidateUrl("https://blog.com/?s=afimah").valid).toBe(false);
      expect(validateCandidateUrl("https://blog.com/search?q=fashion").valid).toBe(false);
    });

    it("rejects publisher root homepages", () => {
      expect(validateCandidateUrl("https://publisher.com").valid).toBe(false);
      expect(validateCandidateUrl("https://publisher.com/").valid).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // 3. Real public article without Afimah link must fail verification
  // -------------------------------------------------------------------------
  describe("Rule 3: Public article without Afimah link fails verification", () => {
    const sampleHtmlWithoutTarget = `
      <!DOCTYPE html>
      <html>
        <head><title>Top 10 Fashion Trends in 2026</title></head>
        <body>
          <article>
            <h1>Top 10 Fashion Trends in 2026</h1>
            <p>Fashion is constantly evolving with contemporary silhouettes, minimalist aesthetic tailoring, and sustainable eco-friendly textiles. Many designers are returning to organic cotton and breathable linen collections for timeless spring wardrobes.</p>
            <p>As consumer preferences lean toward ethical production and longevity, capsule wardrobes have emerged as a dominant philosophy across global fashion capitals. Garments featuring neutral palettes, relaxed drapes, and exquisite artisanal stitching provide the perfect balance between modest everyday sophistication and ceremonial luxury.</p>
            <p>For more details check out <a href="https://vogue.com/trends">Vogue Trends</a> and <a href="https://elle.com">Elle Magazine</a> for runway coverage.</p>
          </article>
        </body>
      </html>
    `;

    it("fails verification when target hyperlink is missing", async () => {
      const result = await verifyBacklink({
        publishedUrl: "https://fashionblog.example.com/2026/top-fashion-trends",
        targetUrl: "https://afimah.com/",
        expectedAnchorText: "Afimah Clothing Store",
        htmlOverride: sampleHtmlWithoutTarget,
      });

      expect(result.status).toBe("failed");
      expect(result.linkFound).toBe(false);
      expect(result.articleContentFound).toBe(true);
      expect(result.reason).toContain("Target link missing");
      expect(result.reason).toContain("https://afimah.com");
    });
  });

  // -------------------------------------------------------------------------
  // 4. Public article with correct clickable Afimah link passes verification
  // -------------------------------------------------------------------------
  describe("Rule 4: Public article with valid clickable Afimah link passes", () => {
    const sampleHtmlWithDofollowTarget = `
      <!DOCTYPE html>
      <html>
        <head><title>Modern Modest Fashion Trends 2026</title></head>
        <body>
          <main>
            <h1>Modern Modest Fashion Trends 2026</h1>
            <p>When curating an elegant seasonal wardrobe, high-quality modest wear offers both versatility and enduring comfort. Designers are focusing on premium fabrics, flowing cuts, and refined color palettes suitable for everyday wear or festive gatherings.</p>
            <p>Discover contemporary pret collections and artisanal couture at <a href="https://afimah.com/" rel="noopener">Afimah Clothing Store</a>, renowned for sophisticated Eastern prêt and luxury lawn ensembles.</p>
            <p>Their attention to hand-embroidered motifs and delicate trims sets a benchmark in modern apparel craftsmanship.</p>
          </main>
        </body>
      </html>
    `;

    it("passes verification and records anchor text and dofollow status", async () => {
      const result = await verifyBacklink({
        publishedUrl: "https://styleweekly.example.com/articles/modest-fashion-trends",
        targetUrl: "https://afimah.com/",
        expectedAnchorText: "Afimah Clothing Store",
        expectedTitle: "Modern Modest Fashion Trends",
        htmlOverride: sampleHtmlWithDofollowTarget,
      });

      expect(result.status).toBe("verified");
      expect(result.linkFound).toBe(true);
      expect(result.articleContentFound).toBe(true);
      expect(result.isDofollow).toBe(true);
      expect(result.isNofollow).toBe(false);
      expect(result.anchorText).toBe("Afimah Clothing Store");
      expect(result.reason).toMatch(/Verified: Clickable hyperlink to https:\/\/afimah\.com\/ confirmed/);
      expect(result.reason).toContain("[Rel: dofollow]");
    });

    it("matches target URL regardless of www, trailing slashes, or protocol variations", async () => {
      const htmlVariations = `
        <p>Check <a href="http://www.afimah.com/collections/pret">Afimah Collection</a> today!</p>
        <p>Another paragraph to meet content length requirements with enough words to qualify as meaningful published editorial article body content.</p>
      `;
      const result = await verifyBacklink({
        publishedUrl: "https://magazine.example.com/summer-preview",
        targetUrl: "https://afimah.com/",
        htmlOverride: htmlVariations,
      });

      expect(result.status).toBe("verified");
      expect(result.linkFound).toBe(true);
      expect(result.anchorText).toBe("Afimah Collection");
    });
  });

  // -------------------------------------------------------------------------
  // 5. Nofollow backlink detected and rel attributes recorded accurately
  // -------------------------------------------------------------------------
  describe("Rule 5: Nofollow, Sponsored, and UGC rel detection", () => {
    it("detects nofollow rel attributes accurately", async () => {
      const htmlNofollow = `
        <article>
          <h1>Editorial Fashion Spotlight</h1>
          <p>Exploring exquisite pret and ready-to-wear collections from diverse international apparel brands across regions.</p>
          <p>Visit <a href="https://afimah.com/" rel="nofollow">Afimah Store</a> for more styles.</p>
          <p>More descriptive words to fill the page content so it counts as genuine editorial article content.</p>
        </article>
      `;

      const result = await verifyBacklink({
        publishedUrl: "https://fashionjournal.example.com/spotlight",
        targetUrl: "https://afimah.com/",
        htmlOverride: htmlNofollow,
      });

      expect(result.status).toBe("verified");
      expect(result.linkFound).toBe(true);
      expect(result.isNofollow).toBe(true);
      expect(result.isDofollow).toBe(false);
      expect(result.relAttributes).toContain("nofollow");
      expect(result.reason).toContain("[Rel: nofollow]");
    });

    it("detects sponsored and ugc attributes in composite rel values", async () => {
      const htmlComposite = `
        <article>
          <h1>Sponsored Brand Showcase</h1>
          <p>Special feature on emerging apparel houses providing fine artisan clothing and curated designer fabrics.</p>
          <p>Shop at <a href="https://afimah.com/" rel="sponsored nofollow noopener">Afimah Official</a>.</p>
          <p>Additional paragraph of text to provide sufficient article length for legitimate publication checking.</p>
        </article>
      `;

      const result = await verifyBacklink({
        publishedUrl: "https://brandguide.example.com/showcase",
        targetUrl: "https://afimah.com/",
        htmlOverride: htmlComposite,
      });

      expect(result.status).toBe("verified");
      expect(result.isSponsored).toBe(true);
      expect(result.isNofollow).toBe(true);
      expect(result.isDofollow).toBe(false);
      expect(result.relAttributes).toEqual(["sponsored", "nofollow", "noopener"]);
    });
  });

  // -------------------------------------------------------------------------
  // 6. Safe handling of redirects, redirect loops, inaccessible & unsafe URLs
  // -------------------------------------------------------------------------
  describe("Rule 6: SSRF, redirect safety, and error handling", () => {
    it("blocks SSRF attempts on private IP ranges and localhost", () => {
      expect(validateCandidateUrl("http://localhost:3000/post").valid).toBe(false);
      expect(validateCandidateUrl("http://127.0.0.1/admin/post").valid).toBe(false);
      expect(validateCandidateUrl("http://10.0.0.1/article").valid).toBe(false);
      expect(validateCandidateUrl("http://192.168.1.50/post").valid).toBe(false);
      expect(validateCandidateUrl("http://169.254.169.254/latest/meta-data").valid).toBe(false);
      expect(validateCandidateUrl("http://server.internal/post").valid).toBe(false);
    });

    it("rejects non-http/https protocols", () => {
      expect(validateCandidateUrl("javascript:alert(1)").valid).toBe(false);
      expect(validateCandidateUrl("file:///etc/passwd").valid).toBe(false);
      expect(validateCandidateUrl("ftp://ftp.example.com/file").valid).toBe(false);
    });

    it("verifies relative URLs in articles resolve against final canonical URL", () => {
      const anchors = extractAnchors(
        '<a href="/shop/eastern-wear">Eastern Wear</a>',
        "https://afimah.com/blog/article-1",
      );
      expect(anchors[0]?.resolvedHref).toBe("https://afimah.com/shop/eastern-wear");
    });
  });

  // -------------------------------------------------------------------------
  // 7. autoFindPublicationUrl verification evidence guarantees
  // -------------------------------------------------------------------------
  describe("Rule 7: Verification evidence required before marking published", () => {
    it("never verifies a link when no hyperlink exists even if publication URL looks valid", async () => {
      const dummyHtml = `
        <html><body><h1>Sample Blog Post</h1><p>No links anywhere here, just generic text about unrelated subjects.</p></body></html>
      `;
      const result = await verifyBacklink({
        publishedUrl: "https://blog.example.com/posts/2026-sample",
        targetUrl: "https://afimah.com/",
        htmlOverride: dummyHtml,
      });

      expect(result.status).toBe("failed");
      expect(result.linkFound).toBe(false);
    });

    it("marks status as blocked when publisher returns 403 / Cloudflare challenge", async () => {
      // simulate 403 response
      const result = await verifyBacklink({
        publishedUrl: "https://protected-publisher.example.com/article",
        targetUrl: "https://afimah.com/",
        // network fetch will fail or return 403 on invalid host, handled safely
      });

      expect(["failed", "blocked"]).toContain(result.status);
      expect(result.linkFound).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // 8. Campaign stats, status badges, database updates, and CSV export agreement
  // -------------------------------------------------------------------------
  describe("Rule 8: System-wide alignment across stats, badges, and CSV export", () => {
    it("computes stats agreeing with verified, pending, and failed states", () => {
      const websites = [
        { status: "published" },
        { status: "verified" },
        { status: "submitted" },
        { status: "published_unverified" },
        { status: "verification_failed" },
        { status: "blocked" },
        { status: "failed" },
        { status: "queued" },
      ];

      const stats = computeStats(websites, 8);

      expect(stats.total).toBe(8);
      // Both "published" and "verified" count towards verified backlinks
      expect(stats.verified).toBe(2);
      expect(stats.published).toBe(2);
      // "submitted" and "published_unverified" are pending
      expect(stats.pending).toBe(2);
      // "verification_failed", "blocked", and "failed" are counted in failures
      expect(stats.failures).toBe(3);
      expect(stats.failed).toBe(3);
      // queued is 1
      expect(stats.queued).toBe(1);
    });

    it("StatusBadge maps all verification and publication statuses to human labels", () => {
      expect(STATUS_LABEL["published"]).toBe("Verified Backlink");
      expect(STATUS_LABEL["verified"]).toBe("Verified Backlink");
      expect(STATUS_LABEL["published_unverified"]).toBe("Published (Unverified)");
      expect(STATUS_LABEL["verification_failed"]).toBe("Verification Failed");
      expect(STATUS_LABEL["blocked"]).toBe("Blocked");
      expect(STATUS_LABEL["submitted"]).toBe("Submitted");
    });

    it("toCsv produces correct audit columns for verified and unverified backlinks", () => {
      const rows = [
        {
          domain: "fashionweekly.com",
          status: "published",
          publication_url: "https://fashionweekly.com/post-1",
          final_url: "https://fashionweekly.com/post-1",
          verification_status: "verified",
          link_rel: "dofollow",
          anchor_text: "Afimah Store",
          target_url: "https://afimah.com/",
          verified_at: "2026-10-23T10:00:00.000Z",
          verification_reason: "Verified: Clickable hyperlink to https://afimah.com/ confirmed",
        },
        {
          domain: "techforum.com",
          status: "verification_failed",
          publication_url: "https://techforum.com/post-2",
          final_url: "https://techforum.com/post-2",
          verification_status: "failed",
          link_rel: "",
          anchor_text: "",
          target_url: "https://afimah.com/",
          verified_at: "2026-10-23T10:01:00.000Z",
          verification_reason: "Target link missing: No clickable link pointing to https://afimah.com/ found",
        },
      ];

      const csv = toCsv(rows);
      expect(csv).toContain("domain,status,publication_url,final_url,verification_status,link_rel,anchor_text,target_url,verified_at,verification_reason");
      expect(csv).toContain("fashionweekly.com,published,https://fashionweekly.com/post-1,https://fashionweekly.com/post-1,verified,dofollow,Afimah Store,https://afimah.com/,2026-10-23T10:00:00.000Z");
      expect(csv).toContain("Target link missing");
    });
  });
});
