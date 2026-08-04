import path from "node:path";

/**
 * 图片序列检测（计划 §9.4）。
 *
 * - standard：点或下划线分隔、至少 4 位 frame number，如 `name.0001.png`。
 * - compatible：一致数字宽度的常见命名，如 `name-001.png`、`name 001.png`；
 *   组内所有文件的数字宽度必须一致（不同 frame width 不分组）。
 * - custom：用户 regex（阶段 5 提供 UI），检测前校验，非法 regex 忽略。
 *
 * 纯函数，无 I/O，便于 fixture 测试。
 */

export interface SequenceGroup {
  /** 稳定 id（base name + extension + 数字宽度）。 */
  id: string;
  directory: string;
  baseName: string;
  extension: string;
  pattern: "standard" | "compatible" | "custom";
  /** 组内文件绝对路径（按帧号升序）。 */
  files: string[];
  /** 每个文件的帧号（升序）。 */
  frames: number[];
  start: number;
  end: number;
  /** 缺失的帧号。 */
  missingFrames: number[];
  /** 数字宽度（帧号左补零位数）。 */
  width: number;
  /** 推断帧率（默认 24，按文件名无法推断时）。 */
  fps: number;
}

interface SequenceCandidate {
  directory: string;
  baseName: string;
  extension: string;
  pattern: "standard" | "compatible" | "custom";
  /** standard 匹配的分隔符（点/下划线）；不同分隔符视为不同序列。 */
  separator: string;
  width: number;
  frame: number;
  filename: string;
}

/** 最小序列长度（少于这个文件数不视为序列，避免误分组）。 */
const MIN_SEQUENCE_FILES = 2;

const STANDARD_PATTERN =
  /^(?<base>.+?)[._](?<frame>\d{4,})(?<ext>\.[A-Za-z0-9]+)$/;
const COMPATIBLE_PATTERN =
  /^(?<base>.+?)[\s-](?<frame>\d{2,})(?<ext>\.[A-Za-z0-9]+)$/;

/** 图片序列常见扩展名（不在此列的文件不参与分组）。 */
const SEQUENCE_EXTENSIONS = new Set([
  "png", "jpg", "jpeg", "webp", "tif", "tiff", "bmp", "exr", "hdr",
  "tga", "dpx", "iff", "j2c", "j2k", "jp2", "jxl",
]);

function parseFrameNumber(raw: string): number {
  return Number.parseInt(raw, 10);
}

/**
 * 从文件列表检测序列分组。
 *
 * @param filenames 同一目录下的文件名（可含路径；分组按 basename 匹配）。
 * @param options.customPatterns 用户自定义 regex（阶段 5 UI 提供）；
 *   非法 regex 自动忽略，不影响 standard/compatible 检测。
 * @param options.defaultFps 默认帧率（24）；可由调用方按 mtime 推断覆盖。
 */
export function detectSequences(
  filenames: string[],
  options: { customPatterns?: Array<string | RegExp>; defaultFps?: number } = {},
): SequenceGroup[] {
  const defaultFps = options.defaultFps ?? 24;
  const candidates: SequenceCandidate[] = [];
  const customPatterns = (options.customPatterns ?? []).flatMap((entry) => {
    try {
      // 字符串模式在调用方配置时可能已非法；编译失败自动忽略。
      const pattern = typeof entry === "string" ? new RegExp(entry) : entry;
      new RegExp(pattern.source, pattern.flags);
      return [pattern];
    } catch {
      return [];
    }
  });

  for (const filename of filenames) {
    const basename = path.basename(filename);
    const extension = path.extname(basename).replace(/^\./, "").toLowerCase();
    if (!SEQUENCE_EXTENSIONS.has(extension)) continue;
    const directory = path.dirname(filename);

    const standard = basename.match(STANDARD_PATTERN);
    if (standard?.groups?.base && standard.groups.frame) {
      const frameIndex = standard[0].indexOf(standard.groups.frame);
      candidates.push({
        directory,
        baseName: standard.groups.base,
        extension,
        pattern: "standard",
        separator: frameIndex > 0 ? standard[0][frameIndex - 1] : "",
        width: standard.groups.frame.length,
        frame: parseFrameNumber(standard.groups.frame),
        filename,
      });
      continue;
    }

    const compatible = basename.match(COMPATIBLE_PATTERN);
    if (compatible?.groups?.base && compatible.groups.frame) {
      candidates.push({
        directory,
        baseName: compatible.groups.base,
        extension,
        pattern: "compatible",
        separator: "",
        width: compatible.groups.frame.length,
        frame: parseFrameNumber(compatible.groups.frame),
        filename,
      });
      continue;
    }

    for (const pattern of customPatterns) {
      const match = basename.match(pattern);
      if (!match) continue;
      // 帧号：优先命名组 frame，其次第一个纯数字捕获组。
      const named = match.groups?.frame;
      const numeric = match
        .slice(1)
        .find((group) => group != null && /^\d+$/.test(group));
      const raw = named ?? numeric;
      if (raw == null) continue;
      const rawIndex = match[0].indexOf(raw);
      candidates.push({
        directory,
        baseName:
          rawIndex >= 0
            ? match[0].slice(0, rawIndex)
            : match[0].replace(raw, ""),
        extension,
        pattern: "custom",
        separator: "",
        width: raw.length,
        frame: parseFrameNumber(raw),
        filename,
      });
      break;
    }
  }

  // 按 (directory, baseName, extension, width) 分组。
  const groups = new Map<string, SequenceCandidate[]>();
  for (const candidate of candidates) {
    const key = [
      candidate.directory,
      candidate.baseName,
      candidate.extension,
      candidate.pattern,
      candidate.separator,
      candidate.width,
    ].join("\u0000");
    const bucket = groups.get(key);
    if (bucket) bucket.push(candidate);
    else groups.set(key, [candidate]);
  }

  const sequences: SequenceGroup[] = [];
  for (const bucket of groups.values()) {
    if (bucket.length < MIN_SEQUENCE_FILES) continue;
    // 按帧号升序；重复帧号（同帧多文件）跳过整组，避免歧义。
    const sorted = [...bucket].sort((left, right) => left.frame - right.frame);
    const seen = new Set<number>();
    let ambiguous = false;
    for (const candidate of sorted) {
      if (seen.has(candidate.frame)) {
        ambiguous = true;
        break;
      }
      seen.add(candidate.frame);
    }
    if (ambiguous) continue;

    const first = sorted[0];
    const start = first.frame;
    const end = sorted[sorted.length - 1].frame;
    const frames = sorted.map((candidate) => candidate.frame);
    const frameSet = new Set(frames);
    const missingFrames: number[] = [];
    for (let frame = start; frame <= end; frame += 1) {
      if (!frameSet.has(frame)) missingFrames.push(frame);
    }
    sequences.push({
      id: `${first.directory}\u0000${first.baseName}\u0000${first.extension}\u0000${first.width}`,
      directory: first.directory,
      baseName: first.baseName,
      extension: first.extension,
      pattern: first.pattern,
      files: sorted.map((candidate) => candidate.filename),
      frames,
      start,
      end,
      missingFrames,
      width: first.width,
      fps: defaultFps,
    });
  }

  // 稳定排序（目录 + 文件名），保证确定性输出。
  sequences.sort((left, right) =>
    `${left.directory}\u0000${left.baseName}`.localeCompare(
      `${right.directory}\u0000${right.baseName}`,
    ),
  );
  return sequences;
}

/**
 * 序列的展示名（如 `name.0001-0010.png`、`name (8 帧, 缺 3)`）。
 */
export function sequenceLabel(sequence: SequenceGroup): string {
  const frame = String(sequence.start).padStart(sequence.width, "0");
  const suffix =
    sequence.end === sequence.start
      ? frame
      : `${frame}-${String(sequence.end).padStart(sequence.width, "0")}`;
  const missing =
    sequence.missingFrames.length > 0
      ? `, 缺 ${sequence.missingFrames.length} 帧`
      : "";
  return `${sequence.baseName}.${suffix}.${sequence.extension}${missing}`;
}
