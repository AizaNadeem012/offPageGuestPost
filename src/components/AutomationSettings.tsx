import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  addPublisherToAllowlist,
  disconnectGmail,
  getGmailConnectionStatus,
  getSettingsFn,
  getSubmissionCredentialStatus,
  saveSubmissionCredentials,
  listPublisherAllowlist,
  removePublisherFromAllowlist,
  saveSettings,
  testEmailConnection,
} from "@/lib/campaign.functions";

type Publisher = Awaited<ReturnType<typeof listPublisherAllowlist>>[number];
type GmailStatus = Awaited<ReturnType<typeof getGmailConnectionStatus>>;
type Settings = Awaited<ReturnType<typeof getSettingsFn>>;
type CredStatus = Awaited<ReturnType<typeof getSubmissionCredentialStatus>>;

export default function AutomationSettings() {
  const [publishers, setPublishers] = useState<Publisher[]>([]);
  const [gmail, setGmail] = useState<GmailStatus | null>(null);
  const [creds, setCreds] = useState<CredStatus | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [domain, setDomain] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [emailTestStatus, setEmailTestStatus] = useState<"idle" | "testing" | "ok" | "fail">("idle");
  const [emailTestMsg, setEmailTestMsg] = useState("");

  const [usernameInput, setUsernameInput] = useState("");
  const [passwordInput, setPasswordInput] = useState("");
  const [senderEmailInput, setSenderEmailInput] = useState("");
  const [appPasswordInput, setAppPasswordInput] = useState("");
  const [savingCreds, setSavingCreds] = useState(false);
  const [showCredForm, setShowCredForm] = useState(false);

  const refresh = async () => {
    setLoading(true);
    setError("");
    try {
      const [approved, connection, credStatus, currentSettings] = await Promise.all([
        listPublisherAllowlist(),
        getGmailConnectionStatus(),
        getSubmissionCredentialStatus(),
        getSettingsFn(),
      ]);
      setPublishers(approved);
      setGmail(connection);
      setCreds(credStatus);
      setSettings(currentSettings);
      if (credStatus?.username && !usernameInput) setUsernameInput(credStatus.username);
      if (credStatus?.senderEmail && !senderEmailInput) setSenderEmailInput(credStatus.senderEmail);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    const params = new URLSearchParams(window.location.search);
    const gmailResult = params.get("gmail");
    if (gmailResult) {
      setNotice(
        gmailResult === "connected"
          ? "✅ Gmail connected. Refresh to see the authorized account."
          : "❌ Gmail connection did not complete. Check the OAuth setup and try again.",
      );
      params.delete("gmail");
      const query = params.toString();
      window.history.replaceState({}, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
    }
  }, []);

  const addPublisher = async () => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await addPublisherToAllowlist({ data: { domain } });
      setDomain("");
      await refresh();
      setNotice("✅ Publisher added to allowlist.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const removePublisher = async (value: string) => {
    setBusy(true);
    setError("");
    try {
      await removePublisherFromAllowlist({ data: { domain: value } });
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const handleSaveCreds = async () => {
    setSavingCreds(true);
    setError("");
    setNotice("");
    try {
      await saveSubmissionCredentials({
        data: {
          username: usernameInput,
          password: passwordInput,
          senderEmail: senderEmailInput,
          appPassword: appPasswordInput,
        },
      });
      setNotice("✅ Credentials updated and saved!");
      setPasswordInput("");
      setAppPasswordInput("");
      setShowCredForm(false);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSavingCreds(false);
    }
  };

  const disconnect = async () => {
    setBusy(true);
    setError("");
    try {
      await disconnectGmail();
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const toggleRequireApproval = async () => {
    if (!settings) return;
    setSavingSettings(true);
    setError("");
    try {
      const updated = await saveSettings({
        data: {
          requestDelayMs: settings.requestDelayMs || 2000,
          maxAttempts: settings.maxAttempts || 3,
          requireApproval: !settings.requireApproval,
          minWords: settings.minWords || 500,
          maxWords: settings.maxWords || 1500,
        },
      });
      setSettings(updated);
      setNotice(
        updated.requireApproval
          ? "⏸️ Manual review enabled — agent will pause before submitting."
          : "✅ Auto-submit enabled — agent will submit forms automatically.",
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSavingSettings(false);
    }
  };

  const testEmail = async () => {
    setEmailTestStatus("testing");
    setEmailTestMsg("");
    try {
      const result = await testEmailConnection();
      if (result.ok) {
        setEmailTestStatus("ok");
        setEmailTestMsg("✅ SMTP connection successful! Emails will send from an3710828@gmail.com");
      } else {
        setEmailTestStatus("fail");
        setEmailTestMsg("❌ " + (result.error ?? "Connection failed"));
      }
    } catch (e) {
      setEmailTestStatus("fail");
      setEmailTestMsg("❌ " + (e instanceof Error ? e.message : String(e)));
    }
  };

  return (
    <div className="space-y-6">
      {error && (
        <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="rounded-md border border-green-500/40 bg-green-500/10 px-3 py-2 text-sm text-green-700 dark:text-green-400">
          {notice}
        </p>
      )}

      {/* ── Auto-Submit Toggle ───────────────────────────────── */}
      <section className="space-y-3 rounded-lg border p-5">
        <div>
          <h2 className="text-lg font-semibold">🤖 Auto-Submit Mode</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            When enabled, the agent automatically logs in and submits your guest post — no waiting for manual approval.
          </p>
        </div>
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading settings…</p>
        ) : (
          <div className="flex flex-wrap items-center gap-4">
            <div className={`flex items-center gap-3 rounded-md border px-4 py-3 ${settings?.requireApproval ? "border-warning/40 bg-warning/10" : "border-green-500/40 bg-green-500/10"}`}>
              <span className="text-2xl">{settings?.requireApproval ? "⏸️" : "🚀"}</span>
              <div>
                <p className="text-sm font-medium">
                  {settings?.requireApproval
                    ? "Manual Review Mode — agent PAUSES before submitting"
                    : "Auto-Submit Active — agent submits automatically"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {settings?.requireApproval
                    ? "Click below to let the agent submit without waiting"
                    : "Agent logs in with your credentials and submits each form"}
                </p>
              </div>
            </div>
            <Button
              variant={settings?.requireApproval ? "default" : "outline"}
              disabled={savingSettings || loading}
              onClick={() => void toggleRequireApproval()}
            >
              {savingSettings ? "Saving…" : settings?.requireApproval ? "🚀 Enable Auto-Submit" : "⏸️ Switch to Manual Review"}
            </Button>
          </div>
        )}
      </section>

      {/* ── Submission Credentials & Gmail Settings Form ────── */}
      <section className="space-y-4 rounded-lg border p-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">🔑 Outreach & Login Credentials</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Configure publisher account login credentials and Gmail SMTP / App Password for automated submissions and email outreach.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowCredForm(!showCredForm)}
          >
            {showCredForm ? "Cancel" : "✏️ Edit Credentials"}
          </Button>
        </div>

        {/* Status Pills */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className={`flex items-center gap-3 rounded-md border p-3 ${creds?.configured ? "border-green-500/40 bg-green-500/10" : "border-destructive/40 bg-destructive/10"}`}>
            <span className="text-xl">{creds?.configured ? "✅" : "⚠️"}</span>
            <div>
              <p className="text-sm font-medium">Publisher Login Account</p>
              <p className="text-xs text-muted-foreground">
                {creds?.configured ? `User: ${creds.username}` : "Credentials not configured"}
              </p>
            </div>
          </div>

          <div className={`flex items-center gap-3 rounded-md border p-3 ${creds?.emailConfigured ? "border-green-500/40 bg-green-500/10" : "border-destructive/40 bg-destructive/10"}`}>
            <span className="text-xl">{creds?.emailConfigured ? "✅" : "⚠️"}</span>
            <div>
              <p className="text-sm font-medium">Gmail SMTP Sender</p>
              <p className="text-xs text-muted-foreground">
                {creds?.emailConfigured ? `From: ${creds.senderEmail}` : "App password missing"}
              </p>
            </div>
          </div>
        </div>

        {/* Email Test Button */}
        {creds?.emailConfigured && (
          <div className="flex items-center gap-3 pt-1">
            <Button
              variant="outline"
              size="sm"
              disabled={emailTestStatus === "testing"}
              onClick={() => void testEmail()}
            >
              {emailTestStatus === "testing" ? "Testing…" : "Test Gmail SMTP Connection"}
            </Button>
            {emailTestMsg && (
              <span className={`text-xs ${emailTestStatus === "ok" ? "text-green-600 font-medium" : "text-destructive"}`}>
                {emailTestMsg}
              </span>
            )}
          </div>
        )}

        {/* Edit Form */}
        {showCredForm && (
          <div className="rounded-lg border bg-muted/20 p-4 space-y-4 pt-4 border-violet-500/30">
            <h3 className="text-sm font-semibold text-violet-600 dark:text-violet-400">Update Credentials</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-medium">Publisher Username / Email</label>
                <input
                  type="text"
                  placeholder="e.g. aizaNadeem18"
                  value={usernameInput}
                  onChange={(e) => setUsernameInput(e.target.value)}
                  className="w-full text-xs border rounded-lg p-2 bg-background focus:outline-none focus:ring-1 focus:ring-violet-500"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium">Publisher Password</label>
                <input
                  type="password"
                  placeholder="Leave blank to keep unchanged"
                  value={passwordInput}
                  onChange={(e) => setPasswordInput(e.target.value)}
                  className="w-full text-xs border rounded-lg p-2 bg-background focus:outline-none focus:ring-1 focus:ring-violet-500"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium">Gmail Sender Email</label>
                <input
                  type="email"
                  placeholder="e.g. an3710828@gmail.com"
                  value={senderEmailInput}
                  onChange={(e) => setSenderEmailInput(e.target.value)}
                  className="w-full text-xs border rounded-lg p-2 bg-background focus:outline-none focus:ring-1 focus:ring-violet-500"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium">Gmail App Password (16 characters)</label>
                <input
                  type="password"
                  placeholder="e.g. abcd efgh ijkl mnop"
                  value={appPasswordInput}
                  onChange={(e) => setAppPasswordInput(e.target.value)}
                  className="w-full text-xs border rounded-lg p-2 bg-background focus:outline-none focus:ring-1 focus:ring-violet-500"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowCredForm(false)}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                disabled={savingCreds}
                onClick={() => void handleSaveCreds()}
                className="bg-violet-600 hover:bg-violet-700 text-white"
              >
                {savingCreds ? "Saving…" : "Save & Apply Credentials"}
              </Button>
            </div>
          </div>
        )}
      </section>

      {/* ── Gmail OTP Mailbox (Read) ─────────────────────────── */}
      <section className="space-y-3 rounded-lg border p-5">
        <div>
          <h2 className="text-lg font-semibold">📨 Gmail OTP Reader</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            When a publisher site sends a verification code (OTP) after login, the agent reads it
            automatically from your connected Gmail inbox.
          </p>
        </div>
        {loading ? (
          <p className="text-sm text-muted-foreground">Checking Gmail…</p>
        ) : gmail?.connected ? (
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-3 rounded-md border border-green-500/40 bg-green-500/10 px-4 py-3">
              <span className="text-2xl">✅</span>
              <div>
                <p className="text-sm font-medium">Gmail OTP reader connected</p>
                <p className="text-xs text-muted-foreground">{gmail.email}</p>
              </div>
            </div>
            <Button variant="outline" size="sm" disabled={busy} onClick={() => void disconnect()}>
              Disconnect
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="rounded-md border border-warning/40 bg-warning/10 px-4 py-3">
              <p className="text-sm font-medium">⚠️ Gmail OTP reader not connected</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Sites that send a verification code after login will require manual intervention
                unless Gmail is connected.
              </p>
            </div>
            {gmail?.configured ? (
              <Button asChild>
                <a href="/api/gmail/oauth/start">Connect Gmail for OTP Reading</a>
              </Button>
            ) : (
              <p className="text-xs text-muted-foreground">
                Configure <code className="bg-muted px-1 rounded">GMAIL_OAUTH_CLIENT_ID</code>,{" "}
                <code className="bg-muted px-1 rounded">GMAIL_OAUTH_CLIENT_SECRET</code>,{" "}
                <code className="bg-muted px-1 rounded">GMAIL_OAUTH_REDIRECT_URI</code>, and{" "}
                <code className="bg-muted px-1 rounded">GMAIL_TOKEN_ENCRYPTION_KEY</code> to enable this.
              </p>
            )}
          </div>
        )}
      </section>

      {/* ── Publisher Allowlist ─────────────────────────────── */}
      <section className="space-y-3 rounded-lg border p-5">
        <div>
          <h2 className="text-lg font-semibold">✅ Approved Publishers</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Only emails from these domains can trigger the OTP auto-read feature.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <input
            aria-label="Publisher domain to approve"
            className="min-w-60 flex-1 rounded-md border bg-background px-3 py-2 text-sm"
            placeholder="publisher.example"
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void addPublisher(); }}
          />
          <Button onClick={() => void addPublisher()} disabled={busy || !domain.trim()}>
            Approve domain
          </Button>
        </div>
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : publishers.length ? (
          <ul className="space-y-2">
            {publishers.map((pub) => (
              <li key={pub.domain} className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm">
                <span className="font-mono text-xs">{pub.domain}</span>
                <Button variant="outline" size="sm" disabled={busy} onClick={() => void removePublisher(pub.domain)}>
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">No publisher domains approved yet.</p>
        )}
      </section>

      {/* ── How It Works ────────────────────────────────────── */}
      <section className="rounded-lg border border-dashed p-5">
        <h2 className="text-base font-semibold">ℹ️ How the automation works</h2>
        <ol className="mt-3 space-y-2 text-sm text-muted-foreground list-decimal list-inside">
          <li>Agent visits each website and finds the guest-post / write-for-us page</li>
          <li>If the site has a <strong>submission form</strong> → logs in with your credentials → fills & submits the form</li>
          <li>If the site only has a <strong>contact email</strong> → sends your article directly from <strong>an3710828@gmail.com</strong></li>
          <li>If an OTP is required after login → reads the code automatically from Gmail inbox</li>
          <li>If a <strong>CAPTCHA</strong> is detected → marks the site <em>Action Required</em> and alerts you</li>
          <li>Successful submissions are marked <strong>Submitted ✅</strong> with a timestamp</li>
        </ol>
      </section>
    </div>
  );
}
