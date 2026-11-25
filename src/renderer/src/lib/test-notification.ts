import type { NotificationTestResult } from "@shared/notifications";

import { api } from "@/lib/api";
import { reportError } from "@/lib/events";
import { toast } from "@/lib/toast";

/**
 * Asks the main process to show a sample system notification and says how it ended, with no message of its own.
 * macOS asks the person for permission the first time one is shown (Electron's notification API, no native code),
 * and answers "not allowed" when it is off for MiniMail. Never throws.
 */
export async function requestTestNotification(): Promise<NotificationTestResult> {
  try {
    return await api.notifications.test();
  } catch (error) {
    reportError("notifications", "Could not show the test notification", error);
    return { status: "failed", message: error instanceof Error ? error.message : String(error) };
  }
}

/** What to tell the person when a test did not show. */
export function testFailureText(result: Exclude<NotificationTestResult, { status: "shown" }>): string {
  return result.status === "not-allowed"
    ? "macOS is not allowing notifications from MiniMail. Allow them in System Settings → Notifications."
    : `Could not show the test notification: ${result.message}`;
}

/**
 * The same test with the answer as a toast, for the Notifications page. Returns how it ended; it never throws.
 */
export async function sendTestNotification(): Promise<NotificationTestResult["status"]> {
  const result = await requestTestNotification();
  if (result.status === "shown") {
    toast.success("Test notification sent", {
      description: "If nothing appeared, allow MiniMail in System Settings → Notifications.",
    });
  } else if (result.status === "not-allowed") {
    toast.error("macOS is not allowing notifications from MiniMail", {
      description: "Allow them in System Settings → Notifications. If MiniMail is already allowed there, macOS does not recognize this build of the app.",
      ...(api.system.platform === "darwin"
        ? {
            action: {
              label: "Open System Settings",
              onClick: () => void api.notifications.openSystemSettings().catch(() => undefined /* expected: recorded by the main process */),
            },
          }
        : {}),
    });
  } else {
    toast.error("Could not show the test notification", { description: result.message });
  }
  return result.status;
}
