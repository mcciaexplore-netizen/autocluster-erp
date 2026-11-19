import { describe, expect, it } from "vitest";
import { DEFAULT_STAGES, stageNameProblem, stageOrderProblem } from "./stages";

const st = (types: string) => types.split("").map((t, i) => ({ id: String(i), name: `S${i}`, type: ({ O: "OPEN", W: "WON", L: "LOST" } as const)[t as "O" | "W" | "L"] }));

describe("stage rules", () => {
  it("the default stages follow the rules", () => {
    expect(stageOrderProblem(DEFAULT_STAGES.map((s, i) => ({ ...s, id: String(i) })))).toBeNull();
  });
  it("needs exactly one Won and one Lost", () => {
    expect(stageOrderProblem(st("OOL"))).toMatch(/one Won/);
    expect(stageOrderProblem(st("OWWL"))).toMatch(/one Won/);
    expect(stageOrderProblem(st("OW"))).toMatch(/one Lost/);
    expect(stageOrderProblem(st("OWLL"))).toMatch(/one Lost/);
  });
  it("needs at least one open stage", () => {
    expect(stageOrderProblem(st("WL"))).toMatch(/open stage/);
  });
  it("Won and Lost stay to the right of open stages, in either order", () => {
    expect(stageOrderProblem(st("OOLW"))).toBeNull();
    expect(stageOrderProblem(st("OWOL"))).toMatch(/right/);
    expect(stageOrderProblem(st("WOL"))).toMatch(/right/);
  });
  it("stage names are required, short and unique (ignoring case)", () => {
    expect(stageNameProblem("  ", [])).toMatch(/enter/);
    expect(stageNameProblem("x".repeat(41), [])).toMatch(/40/);
    expect(stageNameProblem("new", [{ name: "New" }])).toMatch(/already/);
    expect(stageNameProblem("Site visit", [{ name: "New" }])).toBeNull();
  });
});
