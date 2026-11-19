import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  targetLabel,
  targetsConfirm,
  valuesToApply,
  type TargetsAsk,
} from "@/lib/targets-confirm";

/**
 * Asks before Block, Mute or Priority act on several senders or domains at once: lists each address
 * or domain with a checkbox (all ticked), so the user sees and confirms what is affected. The same
 * dialog for every place the commands are offered.
 */
export function TargetsDialog({
  ask,
  onClose,
}: {
  ask: TargetsAsk | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={ask !== null} onOpenChange={(open) => !open && onClose()}>
      {/* Keyed by the ask, so each opening starts with everything ticked. */}
      {ask && (
        <TargetsContent
          key={ask.values.join("\n")}
          ask={ask}
          onClose={onClose}
        />
      )}
    </Dialog>
  );
}

function TargetsContent({
  ask,
  onClose,
}: {
  ask: TargetsAsk;
  onClose: () => void;
}) {
  const [ticked, setTicked] = useState<ReadonlySet<string>>(
    () => new Set(ask.values),
  );
  const apply = valuesToApply(ask, ticked);
  const text = targetsConfirm(ask, apply.length);
  const all = ticked.size === ask.values.length;
  const toggle = (value: string) =>
    setTicked((current) => {
      const next = new Set(current);
      if (!next.delete(value)) next.add(value);
      return next;
    });
  return (
    <DialogContent className="max-w-md">
      <DialogHeader>
        <DialogTitle>{text.title}</DialogTitle>
        <DialogDescription>{text.description}</DialogDescription>
      </DialogHeader>
      <div className="-mx-2 max-h-72 overflow-y-auto">
        {ask.values.map((value) => (
          <label
            key={value}
            className="corner-squircle flex cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 text-sm hover:bg-accent"
          >
            <Checkbox
              checked={ticked.has(value)}
              onCheckedChange={() => toggle(value)}
            />
            <span className="min-w-0 flex-1 truncate">
              {targetLabel(ask.kind, value)}
            </span>
            {!ask.on && ask.active.includes(value) && (
              <span className="shrink-0 text-xs text-muted-foreground">
                {text.alreadyOn}
              </span>
            )}
          </label>
        ))}
      </div>
      <DialogFooter className="items-center sm:justify-between sm:space-x-0">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setTicked(all ? new Set() : new Set(ask.values))}
        >
          {all ? "Untick all" : "Tick all"}
        </Button>
        <div className="flex flex-col-reverse gap-2 sm:flex-row">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant={
              ask.command === "Block" && !ask.on ? "destructive" : "default"
            }
            disabled={apply.length === 0}
            onClick={() => {
              onClose();
              ask.onConfirm(apply);
            }}
          >
            {text.confirmLabel}
          </Button>
        </div>
      </DialogFooter>
    </DialogContent>
  );
}
