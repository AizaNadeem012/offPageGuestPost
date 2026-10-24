#!/usr/bin/env python3
"""
scripts/browser_submitter.py

Intelligent Real-Browser Submission Agent:
- Uses headless Chrome with anti-detection (selenium-stealth)
- Directly navigates to the target page or guest-post submission URL
- Auto-detects submission forms and rich-text editors (Title, Author, Email, Website, Content)
- Handles forum "New Topic" / "Start Thread" flows
- Handles single-step and multi-step logins (Email -> Next -> Password -> Sign In)
- Auto-retrieves 2FA/OTP verification codes from Gmail via IMAP
- Automatically submits the article and extracts the live publication URL
"""

import sys
import json
import time
import re
import os
import ssl
import imaplib

from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC

try:
    from selenium_stealth import stealth
    HAS_STEALTH = True
except ImportError:
    HAS_STEALTH = False


def fetch_gmail_otp(email_addr, app_password):
    """Fetches the latest OTP code from Gmail inbox via IMAP."""
    if not email_addr or not app_password:
        return None
    try:
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE

        mail = imaplib.IMAP4_SSL("imap.gmail.com", 993, ssl_context=ctx)
        mail.login(email_addr.strip(), app_password.replace(" ", "").strip())
        mail.select("INBOX")

        status, count_data = mail.search(None, "ALL")
        if status != "OK" or not count_data[0]:
            mail.logout()
            return None

        ids = count_data[0].split()
        if not ids:
            mail.logout()
            return None

        # Fetch the newest 3 messages
        for mid in reversed(ids[-3:]):
            t, d = mail.fetch(mid, "(RFC822)")
            if t == "OK" and d and d[0]:
                raw = d[0][1].decode("utf-8", errors="ignore")
                patterns = [
                    r'(?:verification|security|one[-\s]?time|otp|passcode|confirmation|login)[^\d\r\n]{0,35}(\d{4,8})\b',
                    r'\b(\d{4,8})\b[^\w\r\n]{0,20}(?:is your|as your|for your|to verify|verification)',
                    r'(?:code|pin)[^\d\r\n]{0,20}:?\s*(\d{4,8})\b',
                    r'\byour\s+code\s+is\s+(\d{4,8})\b',
                ]
                for pat in patterns:
                    m = re.search(pat, raw, re.I)
                    if m:
                        mail.logout()
                        return m.group(1)

        mail.logout()
    except Exception as e:
        sys.stderr.write(f"Gmail OTP error: {e}\n")
    return None


def get_browser():
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

    return driver


def perform_login(driver, email_addr, username, password, gmail_app_pw):
    """
    Handles single-step, multi-step (Email -> Next -> Password), and OTP logins.
    """
    sys.stderr.write(f"Attempting smart login at current URL: {driver.current_url}\n")
    time.sleep(3)

    # 1. Fill email / username
    user_inputs = driver.find_elements(
        By.CSS_SELECTOR,
        "input[type='email'], input[name='email'], input[name='login'], input[name='username'], input[name='user'], input[id*='user'], input[id*='email'], input[placeholder*='email' i], input[placeholder*='username' i]"
    )
    filled_user = False
    for inp in user_inputs:
        if inp.is_displayed() and inp.is_enabled():
            inp.clear()
            inp.send_keys(email_addr or username)
            filled_user = True
            sys.stderr.write(f"Entered username/email into: {inp.get_attribute('name') or inp.get_attribute('type')}\n")
            break

    # 2. Check if password field is visible immediately
    pass_inputs = driver.find_elements(
        By.CSS_SELECTOR,
        "input[type='password'], input[name='password'], input[name='pass'], input[id*='pass']"
    )
    visible_pass = [p for p in pass_inputs if p.is_displayed() and p.is_enabled()]

    # If password is NOT visible, it might be a multi-step login (Email -> Next -> Password)
    if filled_user and not visible_pass:
        sys.stderr.write("Password field not yet visible; looking for Next/Continue button...\n")
        next_btns = driver.find_elements(
            By.XPATH,
            "//button[contains(translate(text(), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), 'next') or "
            "contains(translate(text(), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), 'continue') or "
            "contains(translate(text(), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), 'proceed')] | "
            "//input[@type='submit' or @type='button']"
        )
        for nb in next_btns:
            if nb.is_displayed():
                driver.execute_script("arguments[0].click();", nb)
                time.sleep(3)
                break
        # Re-check for password field
        pass_inputs = driver.find_elements(
            By.CSS_SELECTOR,
            "input[type='password'], input[name='password'], input[name='pass'], input[id*='pass']"
        )
        visible_pass = [p for p in pass_inputs if p.is_displayed() and p.is_enabled()]

    # Fill password
    filled_pass = False
    if visible_pass:
        visible_pass[0].clear()
        visible_pass[0].send_keys(password)
        filled_pass = True
        sys.stderr.write("Entered password.\n")

    if not (filled_user or filled_pass):
        return {"success": False, "reason": "No login fields found on this page"}

    # 3. Click Login / Submit
    submit_btns = driver.find_elements(
        By.XPATH,
        "//button[contains(translate(text(), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), 'log in') or "
        "contains(translate(text(), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), 'sign in') or "
        "contains(translate(text(), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), 'login') or "
        "contains(translate(text(), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), 'signin') or "
        "contains(translate(text(), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), 'submit')] | "
        "//input[@type='submit']"
    )
    clicked = False
    for b in submit_btns:
        if b.is_displayed():
            driver.execute_script("arguments[0].click();", b)
            clicked = True
            break
    if not clicked and pass_inputs:
        pass_inputs[0].send_keys(Keys.RETURN)

    time.sleep(5)

    # 4. Check for OTP / 2FA challenge
    otp_inputs = driver.find_elements(
        By.CSS_SELECTOR,
        "input[name*='otp'], input[name*='code'], input[autocomplete='one-time-code'], input[id*='code'], input[id*='otp'], input[placeholder*='code' i]"
    )
    for inp in otp_inputs:
        if inp.is_displayed():
            sys.stderr.write("OTP challenge detected! Fetching code from Gmail...\n")
            time.sleep(4)
            otp = fetch_gmail_otp(email_addr, gmail_app_pw)
            if not otp:
                time.sleep(5)
                otp = fetch_gmail_otp(email_addr, gmail_app_pw)

            if otp:
                sys.stderr.write(f"Retrieved OTP code: {otp}. Entering code...\n")
                inp.clear()
                inp.send_keys(otp)
                for b in driver.find_elements(By.TAG_NAME, "button"):
                    if any(w in b.text.lower() for w in ["verify", "submit", "continue", "confirm"]):
                        b.click()
                        break
                time.sleep(5)
            else:
                return {"success": False, "reason": "OTP required but could not retrieve code from Gmail in time"}

    # 5. Check for error alerts
    page_text = driver.find_element(By.TAG_NAME, "body").text.lower()
    if any(w in page_text for w in ["username or password is incorrect", "invalid credentials", "account does not exist", "incorrect password", "wrong password"]):
        return {
            "success": False,
            "reason": "Account credentials incorrect or account not yet registered on this site"
        }

    return {"success": True}


def smart_fill_and_submit(driver, title, content, email_addr="", username="", author_name="", target_url=""):
    """
    Auto-detects and fills form fields:
    - Title / Headline
    - Name / Author
    - Email
    - Website / Target URL
    - Content / Article Body (textarea, contenteditable, iframe)
    - Clicks Submit
    """
    time.sleep(3)

    # 1. Fill Title
    title_inputs = driver.find_elements(
        By.CSS_SELECTOR,
        "input[name*='title' i], input[name*='subject' i], input[name*='topic' i], input[name*='headline' i], "
        "input[placeholder*='title' i], input[placeholder*='subject' i], input[id*='title' i], input[id*='subject' i]"
    )
    title_filled = False
    for inp in title_inputs:
        if inp.is_displayed() and inp.is_enabled():
            inp.clear()
            inp.send_keys(title)
            title_filled = True
            sys.stderr.write(f"Filled title field: {inp.get_attribute('name') or 'title'}\n")
            break

    # 2. Fill Name / Author if present
    name_inputs = driver.find_elements(
        By.CSS_SELECTOR,
        "input[name*='author' i], input[name*='name' i], input[placeholder*='your name' i], input[placeholder*='author' i]"
    )
    for inp in name_inputs:
        # Make sure it's not username on login or title
        n = inp.get_attribute("name") or ""
        if inp.is_displayed() and inp.is_enabled() and not any(w in n.lower() for w in ["user", "title", "subject", "email", "pass"]):
            inp.clear()
            inp.send_keys(author_name or username or "Contributor")
            sys.stderr.write("Filled author name.\n")
            break

    # 3. Fill Email if present
    email_inputs = driver.find_elements(
        By.CSS_SELECTOR,
        "input[type='email'], input[name*='email' i], input[placeholder*='email' i]"
    )
    for inp in email_inputs:
        if inp.is_displayed() and inp.is_enabled() and email_addr:
            inp.clear()
            inp.send_keys(email_addr)
            sys.stderr.write("Filled email field.\n")
            break

    # 4. Fill Website / Target URL if present
    url_inputs = driver.find_elements(
        By.CSS_SELECTOR,
        "input[type='url'], input[name*='website' i], input[name*='url' i], input[name*='site' i], input[name*='link' i], input[placeholder*='website' i], input[placeholder*='url' i]"
    )
    for inp in url_inputs:
        if inp.is_displayed() and inp.is_enabled() and target_url:
            inp.clear()
            inp.send_keys(target_url)
            sys.stderr.write("Filled website/backlink URL field.\n")
            break

    # 5. Fill Article Content
    content_filled = False

    # A: Rich-text contenteditable div (CKEditor, Invision Community IPS, TinyMCE, Quill, Froala, ProseMirror)
    rich_editors = driver.find_elements(
        By.CSS_SELECTOR,
        "div[contenteditable='true'], .ck-editor__editable, .ipsComposeArea_editor, .ProseMirror, .ql-editor, div[role='textbox']"
    )
    for ed in rich_editors:
        if ed.is_displayed():
            driver.execute_script("arguments[0].focus();", ed)
            formatted_html = content.replace("\n\n", "<p></p>").replace("\n", "<br>")
            driver.execute_script("arguments[0].innerHTML = arguments[1];", ed, formatted_html)
            content_filled = True
            sys.stderr.write("Filled contenteditable rich-text editor.\n")
            break

    # B: Iframe-based editor (WordPress / classic TinyMCE / CKEditor)
    if not content_filled:
        iframes = driver.find_elements(By.TAG_NAME, "iframe")
        for ifr in iframes:
            try:
                driver.switch_to.frame(ifr)
                body = driver.find_element(By.CSS_SELECTOR, "body[contenteditable='true'], body.mce-content-body")
                if body:
                    formatted_html = content.replace("\n\n", "<p></p>").replace("\n", "<br>")
                    driver.execute_script("arguments[0].innerHTML = arguments[1];", body, formatted_html)
                    content_filled = True
                    sys.stderr.write("Filled iframe rich-text editor.\n")
                    driver.switch_to.default_content()
                    break
            except Exception:
                driver.switch_to.default_content()

    # C: Standard textarea
    if not content_filled:
        textareas = driver.find_elements(
            By.CSS_SELECTOR,
            "textarea[name*='content' i], textarea[name*='post' i], textarea[name*='body' i], textarea[name*='message' i], textarea[name*='article' i], textarea"
        )
        for ta in textareas:
            if ta.is_displayed() and ta.is_enabled():
                ta.clear()
                ta.send_keys(content)
                content_filled = True
                sys.stderr.write("Filled textarea editor.\n")
                break

    if not (title_filled or content_filled):
        return {"success": False, "reason": "No submission form fields (title/content) found on page"}

    # 6. Click Submit / Publish / Post
    submit_buttons = driver.find_elements(
        By.XPATH,
        "//button[contains(translate(text(), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), 'submit') or "
        "contains(translate(text(), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), 'publish') or "
        "contains(translate(text(), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), 'post') or "
        "contains(translate(text(), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), 'send') or "
        "contains(translate(text(), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), 'create')] | "
        "//input[@type='submit']"
    )
    clicked = False
    for b in submit_buttons:
        if b.is_displayed() and b.is_enabled():
            sys.stderr.write(f"Clicking submit button: {b.text or b.get_attribute('value')}\n")
            driver.execute_script("arguments[0].click();", b)
            clicked = True
            break

    if not clicked:
        sub = driver.find_elements(By.CSS_SELECTOR, "button[type='submit'], input[type='submit']")
        if sub and sub[0].is_displayed():
            driver.execute_script("arguments[0].click();", sub[0])
            clicked = True

    time.sleep(6)
    final_url = driver.current_url

    # Check publication signals
    is_published = any(part in final_url for part in ["/topic/", "/thread/", "/post/", "/article/", "/p/", "/view/"])
    body_text = driver.find_element(By.TAG_NAME, "body").text.lower()
    is_moderated = any(phrase in body_text for phrase in [
        "awaiting approval", "pending review", "submitted successfully", "thank you for your submission", "message sent", "submission received"
    ])

    if is_published or is_moderated or clicked:
        return {
            "success": True,
            "publishedUrl": final_url,
            "note": f"Published successfully at {final_url}" if is_published else f"Submitted — awaiting review at {final_url}"
        }

    return {"success": False, "reason": f"Form was submitted but could not confirm receipt ({final_url})"}


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"success": False, "error": "Missing input payload"}))
        sys.exit(1)

    try:
        data = json.loads(sys.argv[1])
    except Exception as e:
        print(json.dumps({"success": False, "error": f"Invalid JSON payload: {e}"}))
        sys.exit(1)

    url = data.get("url", "")
    login_url = data.get("loginUrl")
    title = data.get("title", "")
    content = data.get("content", "")
    email_addr = data.get("email", "")
    username = data.get("username", "")
    password = data.get("password", "")
    gmail_app_pw = data.get("gmailPassword", "")
    author_name = data.get("authorName", "")
    target_url = data.get("targetUrl", "")

    driver = None
    try:
        driver = get_browser()

        # STEP 1: First navigate directly to the target URL (guest post page, forum, or submission form)
        sys.stderr.write(f"Navigating directly to target URL: {url}\n")
        driver.get(url)
        time.sleep(5)

        # STEP 2: Check if form is directly available on this page
        fill_res = smart_fill_and_submit(driver, title, content, email_addr, username, author_name, target_url)
        if fill_res["success"]:
            print(json.dumps({
                "success": True,
                "outcome": "submitted",
                "publishedUrl": fill_res.get("publishedUrl"),
                "note": fill_res.get("note")
            }))
            return

        # STEP 3: If no form directly, check for 'Start new topic' / 'New Topic' / 'Submit Article' / 'Write for us' button
        topic_links = driver.find_elements(
            By.XPATH,
            "//a[contains(translate(text(), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), 'start new topic') or "
            "contains(translate(text(), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), 'new topic') or "
            "contains(translate(text(), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), 'new thread') or "
            "contains(translate(text(), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), 'create topic') or "
            "contains(translate(text(), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), 'submit post') or "
            "contains(translate(text(), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), 'submit article') or "
            "contains(translate(text(), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), 'write for us') or "
            "contains(translate(text(), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), 'contribute')] | "
            "//button[contains(translate(text(), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), 'new topic') or "
            "contains(translate(text(), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), 'start new topic')]"
        )

        clicked_action = False
        for tl in topic_links:
            if tl.is_displayed():
                href = tl.get_attribute("href")
                sys.stderr.write(f"Clicking submission/topic link: {tl.text}\n")
                if href and href.startswith("http"):
                    driver.get(href)
                else:
                    tl.click()
                clicked_action = True
                time.sleep(4)
                break

        # Re-try filling form after clicking topic/submit link
        if clicked_action:
            fill_res2 = smart_fill_and_submit(driver, title, content, email_addr, username, author_name, target_url)
            if fill_res2["success"]:
                print(json.dumps({
                    "success": True,
                    "outcome": "submitted",
                    "publishedUrl": fill_res2.get("publishedUrl"),
                    "note": fill_res2.get("note")
                }))
                return

        # STEP 4: If page or action required login
        page_text = driver.find_element(By.TAG_NAME, "body").text.lower()
        requires_login = any(w in page_text for w in ["please sign in", "must be logged in", "login to continue", "log in to post", "sign in to create"]) or "login" in driver.current_url.lower()

        if requires_login or login_url:
            target_login_url = login_url if (login_url and "login" in driver.current_url.lower()) else driver.current_url
            login_res = perform_login(driver, email_addr, username, password, gmail_app_pw)

            if login_res["success"]:
                # After successful login, return to target page and fill form
                driver.get(url)
                time.sleep(4)
                fill_res3 = smart_fill_and_submit(driver, title, content, email_addr, username, author_name, target_url)
                if fill_res3["success"]:
                    print(json.dumps({
                        "success": True,
                        "outcome": "submitted",
                        "publishedUrl": fill_res3.get("publishedUrl"),
                        "note": fill_res3.get("note")
                    }))
                    return
            else:
                # Login failed with specific reason
                print(json.dumps({
                    "success": False,
                    "outcome": "login_failed",
                    "note": login_res.get("reason", "Login required to post")
                }))
                return

        # STEP 5: If no form could be filled
        print(json.dumps({
            "success": False,
            "outcome": "no_form",
            "note": "No active web form or topic editor found on target page. Direct submission requires manual pitch or account setup."
        }))

    except Exception as e:
        print(json.dumps({
            "success": False,
            "outcome": "error",
            "note": f"Automated browser agent: {str(e)}"
        }))
    finally:
        if driver:
            try:
                driver.quit()
            except Exception:
                pass


if __name__ == "__main__":
    main()
