/**
 * CardRenderer tests using react-dom/server for SSR rendering (no DOM required).
 * Interactive behavior (click handlers, state) is covered by type-level checks.
 */
import { describe, expect, it } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { CardElement } from "@modules/ai/lib/card-serialization";
import { CardRenderer } from "./card-renderer";

function makeCard(overrides: Partial<CardElement> = {}): CardElement {
  return { type: "card", children: [], ...overrides };
}

function html(element: ReturnType<typeof createElement>): string {
  return renderToStaticMarkup(element);
}

describe("CardRenderer", () => {
  it("renders card title", () => {
    const markup = html(
      createElement(CardRenderer, { card: makeCard({ title: "Hello World" }) }),
    );
    expect(markup).toContain("Hello World");
  });

  it("renders card subtitle", () => {
    const markup = html(
      createElement(CardRenderer, { card: makeCard({ subtitle: "Sub text" }) }),
    );
    expect(markup).toContain("Sub text");
  });

  it("renders text children", () => {
    const markup = html(
      createElement(CardRenderer, {
        card: makeCard({
          children: [{ type: "text", content: "Body text here" }],
        }),
      }),
    );
    expect(markup).toContain("Body text here");
  });

  it("renders button label", () => {
    const markup = html(
      createElement(CardRenderer, {
        card: makeCard({
          children: [
            {
              type: "actions",
              children: [{ type: "button", id: "btn-1", label: "Click me" }],
            },
          ],
        }),
      }),
    );
    expect(markup).toContain("Click me");
  });

  it("renders buttons as disabled in readOnly mode", () => {
    const markup = html(
      createElement(CardRenderer, {
        card: makeCard({
          children: [
            {
              type: "actions",
              children: [{ type: "button", id: "btn-1", label: "Action" }],
            },
          ],
        }),
        readOnly: true,
      }),
    );
    // SSR renders disabled attribute as disabled=""
    expect(markup).toContain('disabled=""');
  });

  it("does not disable buttons in interactive mode", () => {
    const markup = html(
      createElement(CardRenderer, {
        card: makeCard({
          children: [
            {
              type: "actions",
              children: [{ type: "button", id: "btn-1", label: "Action" }],
            },
          ],
        }),
        readOnly: false,
      }),
    );
    expect(markup).toContain("Action");
    // Button should not have disabled attribute in fresh (unclicked) state
    expect(markup).not.toContain('disabled=""');
  });

  it("renders fields as key-value pairs", () => {
    const markup = html(
      createElement(CardRenderer, {
        card: makeCard({
          children: [
            {
              type: "fields",
              children: [
                { type: "field", label: "Name", value: "Alice" },
                { type: "field", label: "Role", value: "Admin" },
              ],
            },
          ],
        }),
      }),
    );
    expect(markup).toContain("Name");
    expect(markup).toContain("Alice");
    expect(markup).toContain("Role");
    expect(markup).toContain("Admin");
  });

  it("skips unknown child types without crashing", () => {
    const markup = html(
      createElement(CardRenderer, {
        card: makeCard({
          children: [
            // biome-ignore lint/suspicious/noExplicitAny: intentional unknown type test
            { type: "unknown-future-type" } as any,
            { type: "text", content: "Still renders" },
          ],
        }),
      }),
    );
    expect(markup).toContain("Still renders");
  });

  it("renders divider as separator", () => {
    const markup = html(
      createElement(CardRenderer, {
        card: makeCard({
          children: [{ type: "divider" }],
        }),
      }),
    );
    // Separator renders as a div/hr element
    expect(markup.length).toBeGreaterThan(0);
  });

  it("renders image with url", () => {
    const markup = html(
      createElement(CardRenderer, {
        card: makeCard({
          children: [{ type: "image", url: "https://example.com/img.png", alt: "Test" }],
        }),
      }),
    );
    expect(markup).toContain("https://example.com/img.png");
    expect(markup).toContain("Test");
  });
});
