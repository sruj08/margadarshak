import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  AnimatedContent,
  Banner,
  BlurText,
  Button,
  buttonClassName,
  CountUp,
  EmptyState,
  isSimulatedMode,
  ShinyText,
  SimulatedChip,
  SourceChip,
  SplitText,
  SpotlightCard,
  Stepper,
  VerbTile,
} from "../index";

describe("SimulatedChip (MD-045)", () => {
  const labels = {
    label: "Simulated",
    detail: "Simulated: in production this step runs on Sarathi.",
  };

  it("renders for a mock adapter", () => {
    render(<SimulatedChip adapterMode="mock" {...labels} />);
    const chip = screen.getByTestId("simulated-chip");
    expect(chip.textContent).toContain("Simulated");
    expect(chip.getAttribute("data-adapter-mode")).toBe("mock");
    expect(chip.getAttribute("aria-label")).toBe(labels.detail);
  });

  it("renders nothing for a real adapter", () => {
    const { container } = render(<SimulatedChip adapterMode="nic" {...labels} />);
    expect(container.textContent).toBe("");
  });

  it("follows the API's explicit simulated flag over the mode", () => {
    expect(isSimulatedMode("deeplink", true)).toBe(true);
    expect(isSimulatedMode("mock", false)).toBe(false);
    expect(isSimulatedMode("mock")).toBe(true);
    expect(isSimulatedMode(undefined)).toBe(false);
  });
});

describe("Banner", () => {
  it("announces danger assertively and everything else politely, with a title", () => {
    const { rerender } = render(<Banner tone="danger" title="Fix this" />);
    expect(screen.getByRole("alert").textContent).toContain("Fix this");
    rerender(<Banner tone="caution" title="Check" />);
    expect(screen.getByRole("status").textContent).toContain("Check");
  });
});

describe("Stepper", () => {
  it("marks the current step and spells out every status in words", () => {
    render(
      <Stepper
        label="Your licence journey"
        statusLabels={{ done: "Done", now: "Now", later: "Later" }}
        steps={[
          { id: "ll", label: "Learner's licence", status: "done" },
          { id: "hazard", label: "Hazard practice", status: "now" },
          { id: "dl", label: "Driving test", status: "later" },
        ]}
      />,
    );
    const list = screen.getByRole("list", { name: "Your licence journey" });
    const items = list.querySelectorAll("li");
    expect(items).toHaveLength(3);
    expect(items[1]?.getAttribute("aria-current")).toBe("step");
    expect(list.textContent).toContain("Done");
    expect(list.textContent).toContain("Now");
    expect(list.textContent).toContain("Later");
  });
});

describe("SourceChip", () => {
  it("names the source and the checked date in its accessible name", () => {
    render(
      <SourceChip
        source="CMVR r.32"
        checked="checked 23 Oct 2026"
        labels={{ heading: "Where this comes from" }}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Where this comes from: CMVR r.32, checked 23 Oct 2026" }),
    ).toBeTruthy();
  });
});

describe("VerbTile and EmptyState", () => {
  it("is one link whose name is title + line", () => {
    render(
      <VerbTile href="/en/plan" icon={<svg />} title="Get my first licence" line="LL to DL" />,
    );
    const link = screen.getByRole("link");
    expect(link.getAttribute("href")).toBe("/en/plan");
    expect(link.textContent).toBe("Get my first licenceLL to DL");
  });

  it("empty state has a heading and hides its illustration", () => {
    const { container } = render(
      <EmptyState title="Your road starts here." line="Find your plan." />,
    );
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("Your road starts here.");
    expect(container.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
  });
});

describe("Button", () => {
  it("emits md-button--secondary class on secondary buttons", () => {
    expect(buttonClassName({ variant: "secondary" })).toContain("md-button--secondary");
    const { container } = render(<Button variant="secondary">Secondary</Button>);
    expect(container.querySelector(".md-button--secondary")).toBeTruthy();
  });
});

describe("React Bits primitives (SplitText, BlurText, ShinyText, SpotlightCard, CountUp)", () => {
  it("SplitText preserves exact textContent for Latin chars and Indic words", () => {
    const { container, rerender } = render(
      <SplitText text="Hello, you!" delay={100} duration={0.6} />,
    );
    expect(container.textContent).toBe("Hello, you!");
    expect(container.querySelectorAll(".rb-split-unit").length).toBeGreaterThan(2);

    const hindi = "बिना दलाल के ड्राइविंग लाइसेंस।";
    rerender(<SplitText text={hindi} delay={60} duration={0.6} />);
    expect(container.textContent).toBe(hindi);
    // Indic scripts automatically switch to word-level units so matras never fracture
    expect(container.querySelectorAll(".rb-split-unit")).toHaveLength(5);
  });

  it("BlurText, ShinyText, SpotlightCard, AnimatedContent, and CountUp render cleanly", () => {
    const { container } = render(
      <AnimatedContent>
        <SpotlightCard>
          <ShinyText text="Verified source" />
          <BlurText text="Step by step guidance." />
          <CountUp to={42} />
        </SpotlightCard>
      </AnimatedContent>,
    );
    expect(container.textContent).toContain("Verified source");
    expect(container.textContent).toContain("Step by step guidance.");
    expect(container.textContent).toContain("42");
    expect(container.querySelector(".rb-card-spotlight")).toBeTruthy();
  });
});
