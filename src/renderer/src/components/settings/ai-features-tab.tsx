import { DEFAULT_CODE_MODELS, DEFAULT_COMPLETION_MODELS } from "@shared/ai-providers";
import {
  COMPLETION_LENGTH_HELP,
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
        info="While you write, the model suggests what comes next as dimmed text after your cursor. What you have written, the conversation you are answering and who you are writing to are sent to the model."
      />
      <SettingsSwitchField
        id="completion-enabled"
        label="Suggest text as you write"
        info={
          connected
            ? "Press Tab to keep a suggestion, or Esc to refuse it."
            : "Connect a provider above to use it."
        }
        checked={completion.enabled && connected}
        disabled={!connected}
        onCheckedChange={(enabled) => void save({ ...completion, enabled })}
      />
      {completion.enabled && connected && (
        <>
          <SettingsRow label="How much" info={COMPLETION_LENGTH_HELP[completion.length]}>
            <SettingsSegmentedField
              ariaLabel="How much text to suggest at once"
              value={completion.length}
              options={LENGTH_OPTIONS}
              onValueChange={(length) => void save({ ...completion, length })}
            />
          </SettingsRow>
          <ModelField
            title="Completion model"
            info="Suggestions only help when they arrive as you type, so pick a small model that answers directly. A reasoning model will be slow."
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
    <div className="flex max-w-2xl flex-col gap-4 p-6">
      <SettingsPageHeader title="AI Features" />

      <KeyGate
        ai={ai}
        onState={onState}
        purpose="features"
        intro="AI features, such as finding a verification code the rules could not, run on a chat model from the Vercel AI Gateway or OpenRouter: pick one and add its key. You can pick the model once it is connected."
      >
        <AiProviderField ai={ai} onState={onState} purpose="features" />
        <Separator />
        <ModelField
          title="Verification codes"
          info="When the on-device rules cannot find a verification code in an email, this model reads the start of it. Leave it empty to use rules only."
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
