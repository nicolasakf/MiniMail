import { ExternalLink } from "lucide-react";

import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";

/**
 * Reminds the person that macOS has to allow MiniMail's notifications, with a button that opens System
 * Settings (at MiniMail's entry when the system allows it). It is always shown on a Mac: the system does
 * not tell an app whether it is allowed. Nothing on other systems.
 */
export function SystemNotificationsNote() {
  if (api.system.platform !== "darwin") return null;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <p className="text-xs text-muted-foreground">Make sure notifications are allowed in System Settings.</p>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => void api.notifications.openSystemSettings().catch(() => undefined /* expected: recorded by the main process */)}
      >
        <ExternalLink /> Open System Settings
      </Button>
    </div>
  );
}
