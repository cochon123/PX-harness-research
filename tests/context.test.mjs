import { describe, expect, it } from "vitest";
import tasks from "../evals/tasks.json" with { type: "json" };
import { buildCaseContext } from "../runner/context.mjs";

describe("baseline page context", () => {
  it("exposes stable selectors and card ancestors for feed filtering tasks", () => {
    const task = tasks.find((item) => item.id === "medium-youtube-hide-creator-exact");
    const { pageDom } = buildCaseContext(task);
    const markRoberChannel = pageDom.nodes.find((node) => node.text === "Mark Rober");
    const sponsoredCard = pageDom.nodes.find((node) => node.uid === "video-sponsored-card");

    expect(markRoberChannel.selectorHints).toContain("a[aria-label=\"Mark Rober channel\"]");
    expect(markRoberChannel.semanticContainer).toMatchObject({
      uid: "video-mark-rober-card",
      dataChannel: "Mark Rober"
    });
    expect(markRoberChannel.semanticContainer.selectorHints).toContain("article[data-channel=\"Mark Rober\"]");

    expect(sponsoredCard).toMatchObject({
      dataSponsored: "true",
      dataChannel: "CloudDesk"
    });
    expect(sponsoredCard.selectorHints).toContain("article[data-sponsored=\"true\"]");
  });
});
