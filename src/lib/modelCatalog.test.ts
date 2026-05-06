import { describe, expect, it } from "vitest";

import { PROJECT_MODELS, getArtifactModels, getRuntimeModels } from "@/lib/modelCatalog";

describe("modelCatalog", () => {
  it("lists runtime and artifact models for project review", () => {
    expect(PROJECT_MODELS.length).toBeGreaterThanOrEqual(5);
    expect(getRuntimeModels().length).toBeGreaterThanOrEqual(3);
    expect(getArtifactModels().length).toBeGreaterThanOrEqual(2);
  });

  it("keeps model ids unique", () => {
    const ids = PROJECT_MODELS.map((model) => model.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
