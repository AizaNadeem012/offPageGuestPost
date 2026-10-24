import { STATUS_LABEL } from "@/lib/guestpilot";
import { cn } from "@/lib/utils";
import {
  Clock, Search, PenLine, Eye, CheckCircle2, Send,
  Hourglass, Globe, AlertTriangle, XCircle, SkipForward,
  Play, Pause, Ban, ShieldAlert,
} from "lucide-react";

const TONE: Record<string, string> = {
  queued:                "bg-muted/80 text-muted-foreground border-border/60",
  discovering:           "bg-violet-500/15 text-violet-600 dark:text-violet-400 border-violet-500/30",
  writing:               "bg-violet-500/15 text-violet-600 dark:text-violet-400 border-violet-500/30",
  ready_for_review:      "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30",
  approved:              "bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 border-indigo-500/30",
  submitted:             "bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 border-indigo-500/30",
  awaiting_approval:     "bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 border-indigo-500/30",
  published:             "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30 font-semibold",
  verified:              "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30 font-semibold",
  published_unverified:  "bg-violet-500/15 text-violet-600 dark:text-violet-400 border-violet-500/30",
  submission_attempted:  "bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30",
  submission_confirmed:  "bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 border-indigo-500/30",
  awaiting_review:       "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30",
  verification_failed:   "bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/30",
  blocked:               "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30",
  rejected:              "bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/30",
  discovered:            "bg-muted/80 text-muted-foreground border-border/60",
  qualified:             "bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30",
  ready_to_submit:       "bg-violet-500/15 text-violet-600 dark:text-violet-400 border-violet-500/30",
  action_required:       "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30",
  failed:                "bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/30",
  skipped:               "bg-muted/80 text-muted-foreground border-border/60",
  running:               "bg-violet-500/15 text-violet-600 dark:text-violet-400 border-violet-500/30",
  paused:                "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30",
  completed:             "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
  cancelled:             "bg-muted/80 text-muted-foreground border-border/60",
};

const PULSE: Record<string, boolean> = {
  discovering: true, writing: true, running: true, submission_attempted: true,
};

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  queued:                Clock,
  discovering:           Search,
  writing:               PenLine,
  ready_for_review:      Eye,
  approved:              CheckCircle2,
  submitted:             Send,
  awaiting_approval:     Hourglass,
  published:             CheckCircle2,
  verified:              CheckCircle2,
  published_unverified:  Eye,
  submission_attempted:  Send,
  submission_confirmed:  CheckCircle2,
  awaiting_review:       Hourglass,
  verification_failed:   XCircle,
  blocked:               ShieldAlert,
  rejected:              XCircle,
  discovered:            Search,
  qualified:             CheckCircle2,
  ready_to_submit:       PenLine,
  action_required:       AlertTriangle,
  failed:                XCircle,
  skipped:               SkipForward,
  running:               Play,
  paused:                Pause,
  completed:             CheckCircle2,
  cancelled:             Ban,
};

export function StatusBadge({ status }: { status: string }) {
  const normKey = (status ?? "").toLowerCase();
  const Icon = ICONS[normKey] ?? Globe;
  const pulse = PULSE[normKey] ?? false;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap",
        TONE[normKey] ?? "bg-muted/80 text-muted-foreground border-border/60",
      )}
    >
      {pulse ? (
        <span className="relative flex size-1.5 shrink-0">
          <span className="absolute inline-flex size-full animate-ping rounded-full opacity-75 bg-current" />
          <span className="relative inline-flex size-1.5 rounded-full bg-current" />
        </span>
      ) : (
        <Icon className="size-3" />
      )}
      {STATUS_LABEL[normKey] ?? STATUS_LABEL[status] ?? (status[0] ?? "").toUpperCase() + status.slice(1)}
    </span>
  );
}

export function downloadFile(name: string, content: string, type = "text/csv") {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
