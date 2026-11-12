import { Trash2 } from "lucide-react";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatListTime, contactLabel } from "@/lib/format";
import { deleteDraft, type SavedDraft } from "@/lib/drafts";

import { SenderAvatar } from "./sender-avatar";

interface LocalDraftsProps {
  drafts: readonly SavedDraft[];
  /** Reopens a draft in the composer. */
  onOpen: (draft: SavedDraft) => void;
}

/** One line per draft written here and put aside; click to keep writing. Shown at the top of Drafts. */
export function LocalDrafts({ drafts, onOpen }: LocalDraftsProps) {
  return (
    <div role="list" aria-label="Drafts on this computer" className="shrink-0 pb-2">
      {drafts.map((draft) => {
        const first = draft.to[0] ?? draft.cc[0] ?? draft.bcc[0];
        const recipients = [...draft.to, ...draft.cc, ...draft.bcc].map(contactLabel).join(", ");
        const preview = draft.body.replace(/\s+/g, " ").trim();
        return (
          <div
            key={draft.id}
            role="listitem"
            tabIndex={0}
            className="group mx-2 flex h-10 cursor-default items-center gap-2.5 rounded-md px-3 text-[13px] outline-none hover:bg-accent/50 focus-visible:bg-sidebar-primary/25"
            onClick={() => onOpen(draft)}
            onKeyDown={(event) => {
              if (event.key === "Enter") onOpen(draft);
            }}
          >
            <SenderAvatar contact={first ?? { name: "", email: "?" }} size={26} />
            <span className="w-[clamp(110px,18cqw,260px)] shrink-0 truncate font-medium">
              {recipients || <span className="text-muted-foreground">No recipient</span>}
            </span>
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <span className="shrink truncate font-medium">{draft.subject || "(no subject)"}</span>
              <span className="min-w-0 flex-1 truncate text-muted-foreground">{preview}</span>
            </div>
            <div className="flex w-24 shrink-0 items-center justify-end gap-2">
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label="Delete draft"
                    className="corner-squircle hidden size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground group-hover:flex"
                    onClick={(event) => {
                      event.stopPropagation();
                      deleteDraft(draft.id);
                    }}
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom">Delete draft</TooltipContent>
              </Tooltip>
              <span className="text-[11px] font-semibold text-muted-foreground group-hover:hidden">
                {formatListTime(draft.savedAt)}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
