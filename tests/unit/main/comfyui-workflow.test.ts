import { describe, expect, it } from "vitest";
import {
  assertComfyAddressAllowed,
  inspectBinding,
  inspectWorkflow,
  parseWorkflow,
  type ComfyWorkflowBinding,
} from "../../../src/main/services/ai/comfyui-workflow";

const VALID_WORKFLOW_JSON = JSON.stringify({
  nodes: [
    { id: 1, type: "LoadImage", inputs: { image: "" } },
    { id: 2, type: "CLIPTextEncode", inputs: { text: "" } },
    { id: 3, type: "EmptyLatentImage", inputs: { batch_size: 1 } },
    { id: 4, type: "KSampler", inputs: { seed: 0, strength: 1 } },
    { id: 5, type: "SaveImage", inputs: { images: "4" }, outputs: [{ name: "images" }] },
  ],
  last_node_id: 5,
});

function validBinding(): ComfyWorkflowBinding {
  return {
    source: { nodeId: "1", inputName: "image" },
    referenceSlots: [],
    prompt: { nodeId: "2", inputName: "text" },
    batchSize: { nodeId: "3", inputName: "batch_size" },
    majorChange: { nodeId: "4", inputName: "strength", minorValue: 0.5, majorValue: 1.5 },
    seed: { nodeId: "4", inputName: "seed" },
    outputNodeIds: ["5"],
  };
}

describe("comfyui workflow inspection (FND-009 §9.5)", () => {
  it("parses API-format workflow JSON", () => {
    expect(parseWorkflow(VALID_WORKFLOW_JSON)).not.toBeNull();
    expect(parseWorkflow("not json")).toBeNull();
    expect(parseWorkflow("{}")).toBeNull();
  });

  it("lists nodes, output nodes and image loader inputs", () => {
    const workflow = parseWorkflow(VALID_WORKFLOW_JSON)!;
    const inspection = inspectWorkflow(workflow);
    expect(inspection.valid).toBe(true);
    expect(inspection.nodeCount).toBe(5);
    expect(inspection.outputNodeIds).toEqual(["5"]);
    expect(inspection.imageInputNodes).toEqual([{ nodeId: "1", type: "LoadImage" }]);
  });

  it("detects duplicate node ids and empty workflows", () => {
    const dup = inspectWorkflow({
      nodes: [
        { id: 1, type: "A" },
        { id: 1, type: "B" },
      ],
    });
    expect(dup.valid).toBe(false);
    expect(dup.errors.join()).toContain("重复");
    expect(inspectWorkflow({ nodes: [] }).valid).toBe(false);
  });

  it("validates a complete binding", () => {
    const result = inspectBinding(parseWorkflow(VALID_WORKFLOW_JSON)!, validBinding());
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("reports field-level errors for missing nodes, inputs and outputs", () => {
    const workflow = parseWorkflow(VALID_WORKFLOW_JSON)!;
    const missingNode = inspectBinding(workflow, { ...validBinding(), source: { nodeId: "99", inputName: "image" } });
    expect(missingNode.valid).toBe(false);
    expect(missingNode.errors.some((error) => error.includes("99"))).toBe(true);

    const missingInput = inspectBinding(workflow, { ...validBinding(), prompt: { nodeId: "2", inputName: "nope" } });
    expect(missingInput.valid).toBe(false);
    expect(missingInput.errors.some((error) => error.includes('input "nope"'))).toBe(true);

    const missingOutput = inspectBinding(workflow, { ...validBinding(), outputNodeIds: ["77"] });
    expect(missingOutput.valid).toBe(false);
    expect(missingOutput.errors.some((error) => error.includes("77"))).toBe(true);

    const noOutput = inspectBinding(workflow, { ...validBinding(), outputNodeIds: [] });
    expect(noOutput.valid).toBe(false);
  });

  it("allows empty reference slots but validates configured ones", () => {
    const workflow = parseWorkflow(VALID_WORKFLOW_JSON)!;
    const empty = inspectBinding(workflow, {
      ...validBinding(),
      referenceSlots: [{ nodeId: "1", inputName: "image" }],
    });
    expect(empty.valid).toBe(true);
    const bad = inspectBinding(workflow, {
      ...validBinding(),
      referenceSlots: [{ nodeId: "1", inputName: "missing" }],
    });
    expect(bad.valid).toBe(false);
  });

  it("rejects equal minor/major values", () => {
    const workflow = parseWorkflow(VALID_WORKFLOW_JSON)!;
    const result = inspectBinding(workflow, {
      ...validBinding(),
      majorChange: { nodeId: "4", inputName: "strength", minorValue: 1, majorValue: 1 },
    });
    expect(result.valid).toBe(false);
  });
});

describe("comfyui address validation (FND-009 §9.5)", () => {
  it("allows localhost, loopback and ::1", () => {
    expect(assertComfyAddressAllowed("http://127.0.0.1:8188")).toBe("http://127.0.0.1:8188");
    expect(assertComfyAddressAllowed("http://localhost:8188")).toBe("http://localhost:8188");
    expect(assertComfyAddressAllowed("http://[::1]:8188")).toContain("::1");
  });

  it("rejects LAN, public domains and non-http", () => {
    expect(() => assertComfyAddressAllowed("http://192.168.1.10:8188")).toThrow("COMFYUI_ADDRESS_NOT_LOCAL");
    expect(() => assertComfyAddressAllowed("http://10.0.0.5:8188")).toThrow("COMFYUI_ADDRESS_NOT_LOCAL");
    expect(() => assertComfyAddressAllowed("https://comfy.example.com")).toThrow("COMFYUI_ADDRESS_NOT_LOCAL");
    expect(() => assertComfyAddressAllowed("ftp://127.0.0.1")).toThrow("COMFYUI_INVALID_ADDRESS");
    expect(() => assertComfyAddressAllowed("not a url")).toThrow("COMFYUI_INVALID_ADDRESS");
  });
});
