#!/usr/bin/env python3
"""
scripts/browser_verifier.py

Headless Stealth Browser Verifier:
- Renders JavaScript-heavy Single-Page Applications (SPAs)
- Bypasses Cloudflare / anti-bot challenges via selenium-stealth
- Inspects the live rendered DOM for actual target hyperlinks
- Extracts canonical destination, rel attributes (dofollow/nofollow/sponsored/ugc), and anchor text
"""

import sys
import json
import time
import re
from urllib.parse import urlparse, urljoin

from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By

try:
    from selenium_stealth import stealth
    HAS_STEALTH = True
except ImportError:
    HAS_STEALTH = False


def normalize_dest(url_str):
    if not url_str:
        return ""
    u = url_str.strip().lower()
    u = re.sub(r"^https?://", "", u)
    u = re.sub(r"^www\.", "", u)
    return u.rstrip("/")


def main():
    raw_payload = ""
    if len(sys.argv) > 1 and sys.argv[1] != "-":
        raw_payload = sys.argv[1]
    else:
        raw_payload = sys.stdin.read()

    if not raw_payload.strip():
        print(json.dumps({"success": False, "error": "Missing payload"}))
        sys.exit(1)

    try:
        payload = json.loads(raw_payload)
    except Exception as e:
        print(json.dumps({"success": False, "error": f"Invalid JSON payload: {e}"}))
        sys.exit(1)

    published_url = payload.get("publishedUrl", "").strip()
    target_url = payload.get("targetUrl", "").strip()
    expected_anchor = payload.get("expectedAnchorText", "").strip()
    expected_title = payload.get("expectedTitle", "").strip()

    if not published_url:
        print(json.dumps({"success": False, "error": "Empty publishedUrl"}))
        sys.exit(1)

    # Initialize headless Chrome with stealth
    options = Options()
    options.add_argument("--headless=new")
    options.add_argument("--disable-gpu")
    options.add_argument("--no-sandbox")
    options.add_argument("--disable-dev-shm-usage")
    options.add_argument("--window-size=1920,1080")
    options.add_argument(
        "--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
    )
    options.add_argument("--disable-blink-features=AutomationControlled")
    options.add_experimental_option("excludeSwitches", ["enable-automation"])
    options.add_experimental_option("useAutomationExtension", False)

    driver = None
    try:
        driver = webdriver.Chrome(options=options)
        if HAS_STEALTH:
            stealth(
                driver,
                languages=["en-US", "en"],
                vendor="Google Inc.",
                platform="Win32",
                webgl_vendor="Intel Inc.",
                renderer="Intel Iris OpenGL Engine",
                fix_hairline=True,
            )

        driver.set_page_load_timeout(25)
        driver.get(published_url)

        # Allow time for dynamic SPA hydration or Cloudflare challenge resolution
        time.sleep(3)
        if "Just a moment" in driver.title or "Cloudflare" in driver.title:
            time.sleep(5)

        final_url = driver.current_url
        page_title = driver.title

        # Check if still stuck on Cloudflare Turnstile
        if "Just a moment..." in page_title or "Attention Required" in page_title:
            print(json.dumps({
                "success": False,
                "blocked": True,
                "finalUrl": final_url,
                "reason": "Publisher Cloudflare challenge / Turnstile active and requires human interaction",
            }))
            return

        page_source = driver.page_source

        # Extract all <a> elements from the live rendered DOM
        anchor_elements = driver.find_elements(By.TAG_NAME, "a")
        norm_target = normalize_dest(target_url)

        matched_link = None
        for el in anchor_elements:
            try:
                href = (el.get_attribute("href") or "").strip()
                if not href:
                    continue
                resolved = urljoin(final_url, href)
                norm_link = normalize_dest(resolved)

                is_match = (
                    norm_link == norm_target
                    or norm_link.startswith(norm_target + "/")
                    or norm_link.startswith(norm_target + "?")
                )

                if is_match:
                    raw_rel = (el.get_attribute("rel") or "").lower().strip()
                    rel_tokens = [r for r in raw_rel.split() if r]
                    text = el.text.strip()
                    if not text:
                        # Try img alt inside anchor
                        imgs = el.find_elements(By.TAG_NAME, "img")
                        for img in imgs:
                            alt = img.get_attribute("alt")
                            if alt:
                                text = f"[Image: {alt.strip()}]"
                                break

                    matched_link = {
                        "href": href,
                        "resolvedHref": resolved,
                        "anchorText": text,
                        "rel": rel_tokens,
                    }
                    break
            except Exception:
                continue

        # Content length check
        plain_text = re.sub(r"<[^>]+>", " ", page_source)
        plain_text = re.sub(r"\s+", " ", plain_text).strip()
        word_count = len(plain_text.split())
        title_match = bool(expected_title and expected_title.lower()[:30] in plain_text.lower())
        has_article_content = word_count >= 60 or title_match

        if not matched_link:
            print(json.dumps({
                "success": True,
                "linkFound": False,
                "finalUrl": final_url,
                "articleContentFound": has_article_content,
                "pageTitle": page_title,
                "reason": f"Target link missing: Rendered DOM on {final_url} does not contain a hyperlink to {target_url}",
            }))
            return

        rel_tokens = matched_link["rel"]
        is_nofollow = "nofollow" in rel_tokens
        is_sponsored = "sponsored" in rel_tokens
        is_ugc = "ugc" in rel_tokens
        is_dofollow = not is_nofollow and not is_sponsored and not is_ugc

        rel_desc = "dofollow"
        if is_nofollow:
            rel_desc = "nofollow"
        elif is_sponsored:
            rel_desc = "sponsored"
        elif is_ugc:
            rel_desc = "ugc"

        reason = f"Verified: Clickable hyperlink to {target_url} confirmed in rendered DOM (Anchor: \"{matched_link['anchorText'] or 'No anchor text'}\") [Rel: {rel_desc}]"

        print(json.dumps({
            "success": True,
            "linkFound": True,
            "finalUrl": final_url,
            "anchorText": matched_link["anchorText"],
            "relAttributes": rel_tokens,
            "isNofollow": is_nofollow,
            "isSponsored": is_sponsored,
            "isUgc": is_ugc,
            "isDofollow": is_dofollow,
            "articleContentFound": has_article_content,
            "pageTitle": page_title,
            "reason": reason,
        }))

    except Exception as e:
        sys.stderr.write(f"Browser verifier error: {e}\n")
        print(json.dumps({"success": False, "error": str(e)}))
    finally:
        if driver:
            try:
                driver.quit()
            except Exception:
                pass


if __name__ == "__main__":
    main()
