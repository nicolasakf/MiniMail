import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { resortAdvice, type CategoryChanges } from "@/lib/category-changes";

/** What the person chose when saving categories that change how mail should be sorted. */
export type ResortChoice = "sort" | "keep" | "none";

/**
 * Shown when Save would leave already sorted mail out of step with the categories (one was added,
 * deleted or its criteria rewritten). Nothing has been saved yet: Cancel goes back to editing,
 * "Save and sort again" saves and then opens the sort-again menu, and the third button saves and
 * either leaves mail alone or, after a deletion, files that category's mail under no category.
 */
export function ResortDialog({
  changes,
  saving,
  onChoose,
  onCancel,
}: {
  changes: CategoryChanges | null;
  saving: boolean;
  onChoose: (choice: ResortChoice) => void;
  onCancel: () => void;
}) {
  const advice = changes ? resortAdvice(changes) : null;
  return (
    <Dialog open={changes !== null} onOpenChange={(open) => !open && !saving && onCancel()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Sort your mail again?</DialogTitle>
          <DialogDescription>Your categories changed, so the mail already sorted is out of date.</DialogDescription>
        </DialogHeader>
        <ul className="space-y-1.5 text-sm text-muted-foreground">
          {advice?.lines.map((line) => <li key={line}>{line}</li>)}
        </ul>
        <DialogFooter className="gap-2 sm:space-x-0">
          <Button variant="ghost" disabled={saving} onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="outline" disabled={saving} onClick={() => onChoose(advice?.deleted ? "none" : "keep")}>
            {advice?.deleted ? "Save, no category for its mail" : "Save without sorting"}
          </Button>
          <Button disabled={saving} onClick={() => onChoose("sort")}>
            Save and sort again…
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
