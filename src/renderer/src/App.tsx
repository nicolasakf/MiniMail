import { ThemeProvider } from "next-themes";

import { MailApp } from "@/components/mail-app";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";

/** Providers (theme, tooltips, toasts) around the mail client. Dark by default, like Spark's look. */
export function App() {
  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem disableTransitionOnChange>
      <TooltipProvider delayDuration={300}>
        <MailApp />
        <Toaster />
      </TooltipProvider>
    </ThemeProvider>
  );
}
