import { afterEach, describe, expect, it, vi } from "vitest";
import { generateTransformPlan } from "../runner/plan-client.mjs";

describe("plan client normalization", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("normalizes model visibility values into supported visibility actions", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: JSON.stringify({
              targetMap: { warning: { selectors: ["[data-testid=\"sync-warning\"]"] } },
              rules: [{ id: "hide-warning", type: "visibility", targetRef: "warning", visibility: "hidden" }]
            })
          }
        }]
      })
    })));

    const generation = await generateTransformPlan({
      prompt: "Hide the warning",
      pageContext: {
        hostname: "fixture.local",
        pathname: "/dashboard"
      },
      pageDom: { nodes: [] },
      selections: [],
      reasoningMode: "low"
    });

    expect(generation.plan.rules[0]).toMatchObject({
      type: "visibility",
      targetRef: "warning",
      action: "hide"
    });
    expect(generation.plan.rules[0]).not.toHaveProperty("visibility");
  });

  it("normalizes boolean and display-style visibility variants", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: JSON.stringify({
              targetMap: { item: { selectors: ["article.video-card"] } },
              rules: [
                { id: "hide-bool", type: "visibility", targetRef: "item", visible: false },
                { id: "hide-style", type: "visibility", targetRef: "item", styles: { display: "none" } }
              ]
            })
          }
        }]
      })
    })));

    const generation = await generateTransformPlan({
      prompt: "Hide the item",
      pageContext: {
        hostname: "fixture.local",
        pathname: "/youtube"
      },
      pageDom: { nodes: [] },
      selections: [],
      reasoningMode: "low"
    });

    expect(generation.plan.rules).toEqual([
      { id: "hide-bool", type: "visibility", targetRef: "item", action: "hide" },
      { id: "hide-style", type: "visibility", targetRef: "item", action: "hide" }
    ]);
  });
});
