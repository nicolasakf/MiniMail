import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { defaultCategories } from "@shared/categories";

import { AiSettingsStore } from "./ai-settings";
import { callSystemOne, ProviderHttpError } from "./ai-provider";
import { createJevClassifier, describeAiError, type ClassificationInput } from "./jev";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "minimail-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  vi.unstubAllGlobals();
});

describe("AiSettingsStore", () => {
  it("reads a version 2 file (no providers) as the Vercel AI Gateway and keeps its models", () => {
    const path = join(dir, "ai-settings.json");
    writeFileSync(
      path,
      JSON.stringify({ version: 2, codeModel: "openai/gpt-5-nano", sortModel: "typesafe-ai/jev-1.14.0", sortFolders: ["inbox", "spam"] }),
    );
    const settings = new AiSettingsStore(path);
    expect(settings.sortProvider()).toBe("vercel");
    expect(settings.codeProvider()).toBe("vercel");
    expect(settings.sortModel()).toBe("typesafe-ai/jev-1.14.0");
    expect(settings.codeModel()).toBe("openai/gpt-5-nano");
    expect(settings.sortFolders()).toEqual(["inbox", "spam"]);
    expect(JSON.parse(readFileSync(path, "utf8")).version).toBe(2); // reading does not rewrite the file
  });

  it("reads a version 1 file the same way", () => {
    const path = join(dir, "ai-settings.json");
    writeFileSync(path, JSON.stringify({ version: 1, codeModel: "", sortFolders: ["inbox"] }));
    const settings = new AiSettingsStore(path);
    expect(settings.sortProvider()).toBe("vercel");
    expect(settings.sortModel()).toBe("typesafe-ai/jev");
    expect(settings.codeModel()).toBe("");
  });

  it("puts the new provider's default model in place when the provider changes, and remembers it", () => {
    const path = join(dir, "ai-settings.json");
    const settings = new AiSettingsStore(path);
    settings.setSortProvider("openrouter");
    settings.setCodeProvider("openrouter");
    expect(settings.sortModel()).toBe("typesafe/jev-1.13");
    expect(settings.codeModel()).toBe("reflection/beam-1.0-501b-a23b");

    settings.setSortProvider("typesafe");
    expect(settings.sortModel()).toBe("jev-latest");

    const reopened = new AiSettingsStore(path);
    expect(reopened.sortProvider()).toBe("typesafe");
    expect(reopened.codeProvider()).toBe("openrouter");
    expect(reopened.sortModel()).toBe("jev-latest");
    expect(JSON.parse(readFileSync(path, "utf8")).version).toBe(3);
  });

  it("keeps a model the person typed when the provider is chosen again, and keeps rules-only empty", () => {
    const settings = new AiSettingsStore(join(dir, "ai-settings.json"));
    settings.setSortModel("typesafe-ai/jev-1.14.0");
    settings.setSortProvider("vercel");
    expect(settings.sortModel()).toBe("typesafe-ai/jev-1.14.0");

    settings.setCodeModel("");
    settings.setCodeProvider("openrouter");
    expect(settings.codeModel()).toBe("");
  });
});

const input: ClassificationInput = {
  from: { name: "Acme", email: "no-reply@acme.example" },
  subject: "Your Acme newsletter",
  preview: "This week at Acme",
  signal: "newsletter",
};

function stubFetch(status: number, body: unknown) {
  const fetchMock = vi.fn(async () => new Response(typeof body === "string" ? body : JSON.stringify(body), { status }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("System One over HTTP (OpenRouter and TypeSafe)", () => {
  const answer = { answers: { category: { type: "choice", choice: "Newsletters", confidence: 0.8, probabilities: { Newsletters: 0.9, Ads: 0.1 } } } };

  it("sends the question to OpenRouter's endpoint with the key as a bearer token", async () => {
    const fetchMock = stubFetch(200, answer);
    const classify = createJevClassifier(() => "openrouter", (provider) => (provider === "openrouter" ? "sk-or-key" : undefined));
    const result = await classify(input, defaultCategories());

    expect(result).toEqual({ categoryId: "newsletters", probability: 0.9 });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://openrouter.ai/api/v1/systemone");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer sk-or-key");
    const sent = JSON.parse(String(init.body));
    expect(sent.model).toBe("typesafe/jev-1.13");
    expect(sent.questions.category.type).toBe("choice");
    expect(Object.keys(sent.questions.category.criteria)).toContain("Newsletters");
  });

  it("talks to TypeSafe's own API with the model given for the connection test", async () => {
    const fetchMock = stubFetch(200, answer);
    const classify = createJevClassifier(() => "typesafe", () => "ts_key", () => "jev-latest");
    await classify(input, defaultCategories(), { model: "jev-1.13" });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.typesafe.ai/v1/systemone");
    expect(JSON.parse(String(init.body)).model).toBe("jev-1.13");
  });

  it("treats an answer below the confidence floor as no category", async () => {
    stubFetch(200, { answers: { category: { type: "choice", choice: "Ads", probabilities: { Ads: 0.2 } } } });
    const classify = createJevClassifier(() => "typesafe", () => "ts_key");
    expect((await classify(input, defaultCategories())).categoryId).toBeNull();
  });

  it("says which key is missing without calling anything", async () => {
    const fetchMock = stubFetch(200, answer);
    const classify = createJevClassifier(() => "openrouter", () => undefined);
    await expect(classify(input, defaultCategories())).rejects.toThrow("No OpenRouter key is set.");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports a rejected key with the status and the provider's own words, in either error shape", async () => {
    stubFetch(401, { error: { message: "No auth credentials found", code: 401 } });
    const error = await callSystemOne("openrouter", "bad", { model: "m", state: {}, questions: {} }, AbortSignal.timeout(1000)).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(ProviderHttpError);
    expect((error as ProviderHttpError).statusCode).toBe(401);
    expect(describeAiError(error, "openrouter")).toBe("OpenRouter rejected the API key. Check it and save it again.");

    stubFetch(402, { detail: { error_type: "billing_error", message: "Out of credit" } });
    const noCredit = await callSystemOne("typesafe", "k", { model: "m", state: {}, questions: {} }, AbortSignal.timeout(1000)).catch(
      (caught: unknown) => caught,
    );
    expect(describeAiError(noCredit, "typesafe")).toBe("The TypeSafe API says this key has no credit left.");
  });

  it("keeps the status of an answer that is not JSON", async () => {
    stubFetch(502, "<html>Bad gateway</html>");
    const error = await callSystemOne("openrouter", "k", { model: "m", state: {}, questions: {} }, AbortSignal.timeout(1000)).catch(
      (caught: unknown) => caught,
    );
    expect((error as ProviderHttpError).statusCode).toBe(502);
    expect((error as Error).message).toBe("The request failed (502).");
  });
});
