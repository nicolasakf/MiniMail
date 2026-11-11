import { useCallback, useEffect, useState } from "react";

import { toast } from "sonner";

import type { CategoryState } from "@shared/types";

import { api } from "@/lib/api";

/**
 * The user's categories and the state of the AI classifier. It reloads whenever the mailbox
 * changes, which is also when the classifier reports new answers or a new failure.
 */
export function useCategories() {
  const [state, setState] = useState<CategoryState | null>(null);

  const reload = useCallback(async (): Promise<void> => {
    try {
      setState(await api.categories.get());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => api.mail.onChanged(() => void reload()), [reload]);

  return {
    categories: state?.categories ?? [],
    ai: state?.ai ?? null,
    /** Replaces the state after the dialog saved something. */
    setState,
    reload,
  };
}

export type CategoriesModel = ReturnType<typeof useCategories>;
