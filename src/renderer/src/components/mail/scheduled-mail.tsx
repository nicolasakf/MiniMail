import { useEffect, useState } from "react";

import { Clock3 } from "lucide-react";
import { toast } from "sonner";

import type { ScheduledMessage } from "@shared/types";

import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";

import { composeTimeLabel } from "@/lib/send-later";

export function ScheduledMail({ scope, onVisible }: { scope: string; onVisible: (count: number) => void }) {
  const [entries, setEntries] = useState<ScheduledMessage[]>([]);
  const [canceling, setCanceling] = useState<string>();
  useEffect(() => {
    let active = true;
    const refresh = () => {
      void api.delivery.list().then((items) => {
        if (active) setEntries(items);
      }).catch(() => undefined);
    };
    refresh();
    const stop = api.drafts.onChanged(refresh);
    return () => { active = false; stop(); };
  }, []);
  const visible = entries.filter((item) => scope === "all" || item.accountId === scope);
  useEffect(() => { onVisible(visible.length); }, [onVisible, visible.length]);
  if (!visible.length) return null;

  return (
    <section className="shrink-0 border-b px-4 py-3" aria-label="Scheduled messages">
      <h2 className="mb-2 text-sm font-medium">Scheduled</h2>
      {visible.map((item) => (
        <div key={item.id} className="flex items-center gap-3 rounded-md px-2 py-1.5 text-sm hover:bg-accent/50">
          <Clock3 className="size-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <p className="truncate">{item.subject || "(no subject)"}</p>
            <p className="text-xs text-muted-foreground">
              {item.status === "sending" ? "Sending…" : item.status === "needsReview"
                ? "Delivery unconfirmed. Check Sent before trying again."
                : composeTimeLabel(item.sendAt)}
            </p>
          </div>
          <Button type="button" size="sm" variant="ghost" disabled={item.status === "sending" || canceling !== undefined}
            onClick={async () => {
              setCanceling(item.id);
              try {
                await api.delivery.cancel(item.id);
                toast.success("Moved to drafts");
              } catch (reason) {
                toast.error(reason instanceof Error ? reason.message : String(reason));
              } finally {
                setCanceling(undefined);
              }
            }}>
            Move to drafts
          </Button>
        </div>
      ))}
    </section>
  );
}
