# GuestPilot

GuestPilot prepares and tracks guest-post campaigns without using AI or an AI provider API. You write an article yourself and paste it into the campaign prompt. GuestPilot uses the same supplied article for every website URL in the uploaded CSV/XLSX, discovers publicly available submission information, and saves drafts for review.

## Campaign spreadsheet

The spreadsheet needs only one website URL column:

| Website URL                     |
| ------------------------------- |
| `https://publisher-one.example` |
| `https://publisher-two.example` |

The prompt can be any non-empty text; no business fields or article labels are required. Without AI, GuestPilot saves the text you provide as a draft and does not generate or rewrite an article. If you include an `Article Title:` line, its text is used as the draft title; otherwise the title defaults to `Guest post draft`. If you include `Article Content:`, the text below that label is used as the draft. Otherwise your whole prompt text is used.

```text
Business Name: Your business
Website: https://example.com
Services: Your services
Target Audience: Your audience
Keywords: keyword one, keyword two
Target URLs: https://example.com/page
Anchor Texts: descriptive anchor
Tone: Helpful and professional
Requirements: Editorial preferences

Article Title: Your article title
Article Content:
Paste your complete article here.
End Article
```

These labels are only an example, not required fields. The same draft content will be used for every website in that campaign. Optional spreadsheet columns can override the category, login-page reference, preferred anchor, target URL, priority, or notes for individual sites. Never put passwords, OTPs, API keys, or other secrets in the spreadsheet.

## Local development

Requirements: Node.js 22 or newer, npm, Docker Desktop, and the Supabase CLI.

1. Start local Supabase:

   ```sh
   supabase start
   supabase status
   ```

2. Copy `.env.example` to `.env` and set the Supabase values from `supabase status`. Keep the service-role key server-side; never use it in a `VITE_` variable.

3. Apply the base schema and manual article-content migration using the `DB_URL` shown by `supabase status`:

   ```sh
   psql "<DB_URL>" -f drizzle/migrations/0000_migration.sql
   psql "<DB_URL>" -f drizzle/migrations/0001_manual_article_content.sql
   psql "<DB_URL>" -f drizzle/migrations/0002_authorized_automation.sql
   ```

4. Install and run:

   ```sh
   npm ci
   npm run dev
   ```

No AI keys, Ollama process, or paid AI provider are required. Local development still requires the database and app server. Hosting and managed database services may charge fees.

## Optional Gmail OTP mailbox connection

The dashboard can connect one Gmail mailbox through Google OAuth with read-only Gmail access. The Google OAuth app must be configured by the project owner; no Gmail password or app password belongs in the app or chat.

1. In Google Cloud Console, enable the Gmail API, create an OAuth client of type **Web application**, configure the OAuth consent screen, and add your Google account as a test user if the app is in testing.
2. Add the exact callback URL from `GMAIL_OAUTH_REDIRECT_URI` to the OAuth client's authorized redirect URIs. For the default local setting this is `http://localhost:3000/api/gmail/oauth/callback`; use the actual dev-server origin if it differs.
3. Put the OAuth client ID, client secret, callback URL, and a fresh random 32-byte base64 encryption key in the server-side `.env` using `.env.example` as a guide. Do not add any of these as `VITE_` variables.
4. Apply migration `0002_authorized_automation.sql`, restart the app, add only publisher domains you explicitly approve, and choose **Connect Gmail with Google**.

The refresh token is encrypted with AES-256-GCM before it is stored in Supabase. A server-only helper can look for recent numeric codes from an explicitly approved publisher domain; no OTP is shown in the dashboard. Publisher login automation is not yet implemented, so this helper is not currently invoked by campaign processing. CAPTCHA and human-verification challenges still pause for you. Revoke access in your Google Account's third-party connections page and disconnect it in the dashboard when no longer needed.

This project currently has no app-level user sign-in. Keep it bound to your own local machine and do not expose it to the public internet; the service-role key provides database-wide privileges.

## Current limitations

- CSV/XLSX import and public website discovery are best-effort.
- When a discovered guidelines page explicitly mentions free submissions or mentions fees, the results show that as a review signal only; wording detection does not establish permission, eligibility, or guaranteed cost.
- Supplied articles are stored as drafts for review; the app does not yet create publisher accounts, log in to publisher sites, submit forms, send outreach email, or publish posts.
- Publisher approvals and Gmail OAuth are groundwork for a future authorized workflow. Allowlisting alone does not establish that a publisher permits automation.
- If discovery detects CAPTCHA or another human-verification step, the website is marked `Action required` and the dashboard tells you automation stopped; the app does not solve or bypass the challenge.
- A discovered form or recorded submission is not proof of publication. Verify a live article and backlink before reporting it as published.
- Respect each publisher's terms and access restrictions. The app does not bypass CAPTCHA, login controls, or human verification.
- Campaign processing is dashboard-triggered rather than a durable background worker.
- Publisher login/submission automation, a production multi-user authorization system, a publisher credential vault, and automated reporting are not implemented.

## Checks

```sh
npm test
npm run build
npm run lint
```

Never commit `.env` or credentials.
