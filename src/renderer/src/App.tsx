import { ThemeProvider } from "next-themes";

import { DetachedComposer } from "@/components/mail/detached-composer";
import { MailApp } from "@/components/mail-app";
import { UpdateToasts } from "@/components/update-toasts";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";

/** Providers (theme, tooltips, toasts) around the mail client. Follows the system theme by default. */
export function App() {
  return (
    <ThemeProvider attribute="class" themes={["light", "dark"]} defaultTheme="system" enableSystem disableTransitionOnChange>
      <TooltipProvider delayDuration={300}>
        {new URLSearchParams(window.location.search).has("composer") ? (
          <DetachedComposer />
        ) : (
          <>
            <MailApp />
            <UpdateToasts />
          </>
        )}
        <Toaster />
      </TooltipProvider>
    </ThemeProvider>
  );
}
