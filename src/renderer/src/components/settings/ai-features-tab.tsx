import { DEFAULT_CODE_MODELS, DEFAULT_COMPLETION_MODELS } from "@shared/ai-providers";
import {
  COMPLETION_LENGTH_LABELS,
  COMPLETION_LENGTHS,
  DEFAULT_COMPLETION,
  type CompletionSettings,
} from "@shared/completion";
import { CODE_MODEL_PATTERN } from "@shared/verification-code";
import type { AiStatus, CategoryState } from "@shared/types";

import { AiProviderField, KeyGate } from "@/components/mail/key-gate";
import { ModelField } from "@/components/mail/model-field";
import { Separator } from "@/components/ui/separator";
import { api } from "@/lib/api";
import { toast } from "@/lib/toast";
import { retryMissingCodes } from "@/lib/verification-codes";

import { SettingsPageHeader, SettingsRow, SettingsSectionTitle, SettingsSegmentedField, SettingsSwitchField } from "./fields";

interface AiFeaturesTabProps {
  ai: AiStatus | null;
  onState: (state: CategoryState) => void;
}

const LENGTH_OPTIONS = COMPLETION_LENGTHS.map((value) => ({ value, label: COMPLETION_LENGTH_LABELS[value] }));

/**
 * Text completion in the composer: whether it is on, how much the model may write at once, and
 * which model writes it. The model is its own choice, because a suggestion is only worth having when
 * it arrives at once, which a reasoning model rarely does. It runs through the provider chosen above,
 * so it can only be used while that provider has a key.
 */
function CompletionSection({ ai, onState }: AiFeaturesTabProps) {
  const completion: CompletionSettings = ai?.completion ?? DEFAULT_COMPLETION;
  const connected = ai?.codeConfigured ?? false;
  const save = async (next: CompletionSettings): Promise<boolean> => {
    try {
      onState(await api.categories.setCompletion(next));
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
      return false;
    }
  };
  const saveModel = async (model: string) => {
    if (await save({ ...completion, model })) toast.success(`Text completion will use ${model}.`);
  };

  return (
    <div className="flex flex-col gap-3">
      <SettingsSectionTitle
        title="Text completion"
        info="Sends your text, the conversation and the recipients to the model."
      />
      <SettingsSwitchField
        id="completion-enabled"
        label="Suggest text as you write"
        checked={completion.enabled && connected}
        disabled={!connected}
        onCheckedChange={(enabled) => void save({ ...completion, enabled })}
      />
      {completion.enabled && connected && (
        <>
          <SettingsRow label="How much">
            <SettingsSegmentedField
              ariaLabel="How much text to suggest at once"
              value={completion.length}
              options={LENGTH_OPTIONS}
              onValueChange={(length) => void save({ ...completion, length })}
            />
          </SettingsRow>
          <ModelField
            title="Completion model"
            purpose="features"
            saved={completion.model}
            defaultModel={DEFAULT_COMPLETION_MODELS[ai?.codeProvider ?? "vercel"]}
            allowEmpty={false}
            pattern={CODE_MODEL_PATTERN}
            ariaLabel="Model for text completion"
            configured={connected}
            onSave={saveModel}
          />
        </>
      )}
    </div>
  );
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
    <div className="flex max-w-2xl flex-col gap-4">
      <SettingsPageHeader title="AI Features" />

      <KeyGate
        ai={ai}
        onState={onState}
        purpose="features"
        intro="AI features, such as finding a verification code the rules could not, run on a chat model from the Vercel AI Gateway or OpenRouter: pick one and add its key. You can pick the model once it is connected."
      >
        <section aria-label="AI provider" className="corner-squircle plate-2 rounded-2xl p-4">
          <AiProviderField ai={ai} onState={onState} purpose="features" />
        </section>
        <ModelField
          title="Verification codes"
          info="The model that looks for a verification code when the rules find none. Empty means rules only."
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
        <Separator />
        <CompletionSection ai={ai} onState={onState} />
      </KeyGate>
    </div>
  );
}
