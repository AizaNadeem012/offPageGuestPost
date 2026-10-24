/**
 * email.server.ts
 *
 * Gmail SMTP email sender using Nodemailer + App Password.
 * Credentials are read from environment variables:
 *   GMAIL_SENDER_EMAIL   = "an3710828@gmail.com"
 *   GMAIL_APP_PASSWORD   = "xxxx xxxx xxxx xxxx"  (16-char Google App Password)
 *
 * How to get App Password:
 *  1. Go to https://myaccount.google.com/security
 *  2. Enable 2-Step Verification if not already
 *  3. Search "App Passwords" → create one for "Mail"
 *  4. Copy the 16-char code and put in .env
 */

import nodemailer from "nodemailer";

function getEmailConfig() {
  const email =
    (process.env as Record<string, string | undefined>)["GMAIL_SENDER_EMAIL"] ?? "";
  const appPassword =
    (process.env as Record<string, string | undefined>)["GMAIL_APP_PASSWORD"] ?? "";
  return { email, appPassword };
}

function createTransport() {
  const { email, appPassword } = getEmailConfig();
  if (!email || !appPassword) {
    throw new Error(
      "Email not configured. Add GMAIL_SENDER_EMAIL and GMAIL_APP_PASSWORD to .env",
    );
  }
  return nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: email,
      pass: appPassword,
    },
  });
}

export type EmailOptions = {
  to: string;
  subject: string;
  text: string;
  html?: string;
};

/** Send one email from your Gmail account. */
export async function sendEmail(opts: EmailOptions): Promise<{ success: true; messageId: string }> {
  const { email } = getEmailConfig();
  const transporter = createTransport();
  const info = await transporter.sendMail({
    from: `"GuestPilot" <${email}>`,
    to: opts.to,
    subject: opts.subject,
    text: opts.text,
    html: opts.html ?? opts.text.replace(/\n/g, "<br>"),
  });
  return { success: true, messageId: info.messageId as string };
}

/**
 * Send a guest-post outreach email.
 * Used when a site has no submission form but has a contact email.
 */
export async function sendGuestPostOutreach(opts: {
  to: string;
  publisherDomain: string;
  article: { title: string; content: string };
  authorName?: string;
  targetUrl?: string;
  anchorText?: string;
}): Promise<{ success: true; messageId: string }> {
  const { to, publisherDomain, article, authorName, targetUrl, anchorText } = opts;

  const subject = `Guest Post Submission: "${article.title}"`;

  const text = `Dear ${publisherDomain} Team,

I hope this email finds you well. I am reaching out to submit a guest post for consideration on your website.

Article Title: ${article.title}
${authorName ? `Author: ${authorName}` : ""}
${targetUrl ? `Target URL for backlink: ${targetUrl}` : ""}
${anchorText ? `Suggested anchor text: ${anchorText}` : ""}

--- ARTICLE CONTENT ---

${article.content}

--- END OF ARTICLE ---

Please let me know if you have any questions or need any revisions. I look forward to hearing from you.

Best regards,
${authorName ?? "Guest Post Team"}`;

  const html = `
<p>Dear ${publisherDomain} Team,</p>
<p>I hope this email finds you well. I am reaching out to submit a guest post for consideration on your website.</p>
<ul>
  <li><strong>Article Title:</strong> ${article.title}</li>
  ${authorName ? `<li><strong>Author:</strong> ${authorName}</li>` : ""}
  ${targetUrl ? `<li><strong>Target URL for backlink:</strong> <a href="${targetUrl}">${targetUrl}</a></li>` : ""}
  ${anchorText ? `<li><strong>Suggested anchor text:</strong> ${anchorText}</li>` : ""}
</ul>
<hr>
<h2>${article.title}</h2>
<div style="font-family:Georgia,serif;line-height:1.7">
  ${article.content.split("\n").map((p) => p.trim() ? `<p>${p}</p>` : "").join("")}
</div>
<hr>
<p>Please let me know if you have any questions or need any revisions. I look forward to hearing from you.</p>
<p>Best regards,<br>${authorName ?? "Guest Post Team"}</p>`;

  return sendEmail({ to, subject, text, html });
}

/** Verify SMTP connection works (call this on startup or from settings). */
export async function verifyEmailConnection(): Promise<{ ok: boolean; error?: string }> {
  try {
    const transporter = createTransport();
    await transporter.verify();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
