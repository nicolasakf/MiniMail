import { DEFAULT_CODE_MODELS } from "@shared/ai-providers";
import { CODE_MODEL_PATTERN } from "@shared/verification-code";
import type { AiStatus, CategoryState } from "@shared/types";

import { AiProviderField, KeyGate } from "@/components/mail/key-gate";
import { ModelField } from "@/components/mail/model-field";
import { api } from "@/lib/api";
import { toast } from "@/lib/toast";
import { retryMissingCodes } from "@/lib/verification-codes";

import { SettingsPageHeader } from "./fields";

interface AiFeaturesTabProps {
  ai: AiStatus | null;
  onState: (state: CategoryState) => void;
}

/** The model behind every feature that reads an email with AI, such as verification codes the rules cannot find. */
export function AiFeaturesTab({ ai, onState }: AiFeaturesTabProps) {
  const save = async (next: string) => {
    try {
      onState(await api.categories.setCodeModel(next));
      retryMissingCodes();
      toast.success(next ? `AI-enabled features will use ${next}.` : "AI-enabled features are off: rules only.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <div className="flex max-w-2xl flex-col gap-4 p-6">
      <SettingsPageHeader title="AI Features" />

      <KeyGate
        ai={ai}
        onState={onState}
        purpose="features"
        intro="AI features, such as finding a verification code the rules could not, run on a chat model from the Vercel AI Gateway or OpenRouter: pick one and add its key. You can pick the model once it is connected."
      >
        <AiProviderField ai={ai} onState={onState} purpose="features" />
        <ModelField
          title="Verification codes"
          help="When the on-device rules cannot find a verification code in an email, this model reads the start of it. Leave it empty to use rules only."
          purpose="features"
          saved={ai?.codeModel ?? DEFAULT_CODE_MODELS.vercel}
          defaultModel={DEFAULT_CODE_MODELS[ai?.codeProvider ?? "vercel"]}
          allowEmpty
          pattern={CODE_MODEL_PATTERN}
          ariaLabel="Model for AI-enabled features"
          configured={ai?.codeConfigured ?? false}
          onSave={save}
          emptyNote="Rules only: no email text is sent to a model."
        />
      </KeyGate>
    </div>
  );
}
