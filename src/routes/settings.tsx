import { createFileRoute } from "@tanstack/react-router";
import AutomationSettings from "@/components/AutomationSettings";

export const Route = createFileRoute("/settings")({
  component: SettingsPage,
});

function SettingsPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">⚙️ Automation Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Control how the agent logs in, submits forms, and handles verification codes.
        </p>
      </div>
      <AutomationSettings />
    </div>
  );
}
