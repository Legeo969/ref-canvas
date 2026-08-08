export interface FileSequenceInfo {
  key: string;
  frame: number;
  count: number;
  startFrame: number;
  endFrame: number;
}

interface SequenceCandidate {
  path: string;
  key: string;
  frame: number;
}

const frameSuffix = /^(.*?)[_.-](\d{3,})(\.[^.]+)$/;

/** 识别同目录中至少三帧的常见文件序列，不读取文件内容。 */
export function detectFileSequences(
  entries: Array<{ path: string; name: string; isDirectory: boolean }>,
): Map<string, FileSequenceInfo> {
  const groups = new Map<string, SequenceCandidate[]>();
  for (const entry of entries) {
    if (entry.isDirectory) continue;
    const match = frameSuffix.exec(entry.name);
    if (!match) continue;
    const key = `${match[1].toLocaleLowerCase("en-US")}\0${match[3].toLocaleLowerCase("en-US")}`;
    const candidates = groups.get(key) ?? [];
    candidates.push({
      path: entry.path,
      key,
      frame: Number.parseInt(match[2], 10),
    });
    groups.set(key, candidates);
  }

  const result = new Map<string, FileSequenceInfo>();
  for (const [key, candidates] of groups) {
    const unique = new Map(candidates.map((candidate) => [candidate.frame, candidate]));
    if (unique.size < 3) continue;
    const frames = [...unique.keys()].sort((left, right) => left - right);
    for (const candidate of unique.values()) {
      result.set(candidate.path, {
        key,
        frame: candidate.frame,
        count: frames.length,
        startFrame: frames[0],
        endFrame: frames[frames.length - 1],
      });
    }
  }
  return result;
}
