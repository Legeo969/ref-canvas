/**
 * ComfyUI API-format workflow 检查与绑定（found-clone.md §9.5）。
 *
 * 用户导入 ComfyUI API-format workflow JSON（{ nodes: [{id,type,inputs}], links }），
 * 配置源图、参考图、提示词、重大改动、批量数、seed 与输出节点绑定。
 * inspectWorkflow 验证 node id、input name 与 output node；缺失时在启动前返回
 * 字段级错误。
 */
export interface ComfyInputBinding {
  nodeId: string;
  inputName: string;
}

export interface ComfyWorkflowBinding {
  source: ComfyInputBinding;
  referenceSlots: ComfyInputBinding[];
  prompt: ComfyInputBinding;
  batchSize: ComfyInputBinding;
  majorChange?: ComfyInputBinding & { minorValue: number; majorValue: number };
  seed?: ComfyInputBinding;
  outputNodeIds: string[];
}

export interface ComfyWorkflowNode {
  id: string | number;
  type: string;
  inputs?: Record<string, unknown>;
  outputs?: Array<{ name?: string; type?: string }>;
}

export interface ComfyWorkflowDocument {
  nodes?: ComfyWorkflowNode[];
  links?: Array<unknown>;
  last_node_id?: number;
}

export interface ComfyWorkflowInspection {
  valid: boolean;
  /** 字段级错误（节点 id、input 缺失、输出节点不存在等）。 */
  errors: string[];
  nodeCount: number;
  outputNodeIds: string[];
  /** 可绑定为 source 的图片输入节点（LOADIMAGE 等）。 */
  imageInputNodes: Array<{ nodeId: string; type: string }>;
}

const IMAGE_LOADER_TYPES = new Set([
  "LoadImage",
  "VHS_LoadImage",
  "LoadImageFromPath",
  "ETN_LoadImageBase64",
]);

export function parseWorkflow(json: string): ComfyWorkflowDocument | null {
  try {
    const parsed = JSON.parse(json) as ComfyWorkflowDocument;
    if (!parsed || !Array.isArray(parsed.nodes)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * 检查 API-format workflow：返回节点清单与可绑定输入。
 * 不会校验绑定正确性（那是 inspectBinding 的职责）。
 */
export function inspectWorkflow(workflow: ComfyWorkflowDocument): ComfyWorkflowInspection {
  const nodes = workflow.nodes ?? [];
  const errors: string[] = [];
  const nodeIds = new Set(nodes.map((node) => String(node.id)));
  if (nodeIds.size !== nodes.length) {
    errors.push("节点 id 重复");
  }
  const outputNodeIds = nodes
    .filter((node) => Array.isArray(node.outputs) && node.outputs.length > 0)
    .map((node) => String(node.id));
  const imageInputNodes = nodes
    .filter((node) => IMAGE_LOADER_TYPES.has(node.type))
    .map((node) => ({ nodeId: String(node.id), type: node.type }));
  if (!errors.length && nodes.length === 0) {
    errors.push("workflow 不包含任何节点");
  }
  return {
    valid: errors.length === 0,
    errors,
    nodeCount: nodes.length,
    outputNodeIds,
    imageInputNodes,
  };
}

/**
 * 校验绑定：node id 与 input name 必须存在；引用图槽位可空但已配置的必须有效；
 * 输出节点必须存在。返回字段级错误（启动前检查）。
 */
export function inspectBinding(
  workflow: ComfyWorkflowDocument,
  binding: ComfyWorkflowBinding,
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const nodes = workflow.nodes ?? [];
  const nodeById = new Map(nodes.map((node) => [String(node.id), node]));

  const checkInput = (
    label: string,
    bound: ComfyInputBinding | undefined,
    required: boolean,
  ): void => {
    if (!bound) {
      if (required) errors.push(`${label} 未绑定`);
      return;
    }
    const node = nodeById.get(String(bound.nodeId));
    if (!node) {
      errors.push(`${label}:节点 ${bound.nodeId} 不存在`);
      return;
    }
    if (!node.inputs || !(bound.inputName in node.inputs)) {
      errors.push(`${label}:节点 ${bound.nodeId} 缺少 input "${bound.inputName}"`);
    }
  };

  checkInput("源图", binding.source, true);
  binding.referenceSlots.forEach((slot, index) => {
    checkInput(`参考图槽位 ${index + 1}`, slot, false);
  });
  checkInput("提示词", binding.prompt, true);
  checkInput("批量数", binding.batchSize, true);
  checkInput("重大改动", binding.majorChange, false);
  checkInput("seed", binding.seed, false);

  if (binding.outputNodeIds.length === 0) {
    errors.push("至少需要一个输出节点");
  } else {
    for (const nodeId of binding.outputNodeIds) {
      if (!nodeById.has(String(nodeId))) {
        errors.push(`输出节点 ${nodeId} 不存在`);
      }
    }
  }
  if (binding.majorChange && binding.majorChange.minorValue === binding.majorChange.majorValue) {
    errors.push("重大改动的 minor/major 值不能相同");
  }
  return { valid: errors.length === 0, errors };
}

/** ComfyUI 地址只允许 localhost / 127.0.0.0/8 / ::1（§9.5，不扫描局域网）。 */
export function assertComfyAddressAllowed(address: string): string {
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    throw new Error("COMFYUI_INVALID_ADDRESS");
  }
  const { hostname, protocol } = url;
  if (protocol !== "http:" && protocol !== "https:") {
    throw new Error("COMFYUI_INVALID_ADDRESS");
  }
  const normalizedHost = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const allowed =
    normalizedHost === "localhost" ||
    normalizedHost === "::1" ||
    /^127\.(?:\d{1,3}\.){2}\d{1,3}$/.test(normalizedHost) &&
      normalizedHost.split(".").every((part) => Number(part) <= 255);
  if (!allowed) throw new Error("COMFYUI_ADDRESS_NOT_LOCAL");
  return url.toString().replace(/\/$/, "");
}
