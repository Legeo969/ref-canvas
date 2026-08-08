export interface StartupMountCandidate {
  path: string;
  state: "online" | "offline" | "permission-denied";
}

export interface StartupPathCandidate {
  path: string;
}

export interface StartupDirectoryInput {
  rememberedPath: string | null;
  mounts: StartupMountCandidate[];
  /** 可直接浏览的本地磁盘卷标根目录。 */
  roots?: StartupPathCandidate[];
  quickAccess: StartupPathCandidate[];
}

export function isPathInsideMount(candidate: string, mount: string): boolean {
  const normalizedCandidate = candidate.replace(/\//g, "\\").toLocaleLowerCase("en-US");
  const normalizedMount = mount
    .replace(/\//g, "\\")
    .replace(/[\\/]+$/, "")
    .toLocaleLowerCase("en-US");
  return (
    normalizedCandidate === normalizedMount ||
    normalizedCandidate.startsWith(`${normalizedMount}\\`)
  );
}

/** 磁盘优先启动：恢复可访问卷标或保留的 NAS 根目录内的位置。 */
export function startupDirectoryCandidates(
  input: StartupDirectoryInput,
): string[] {
  const onlineMounts = input.mounts.filter((mount) => mount.state === "online");
  const rootPaths = (input.roots ?? []).map((root) => root.path);
  const allowedRoots = [
    ...rootPaths,
    ...onlineMounts.map((mount) => mount.path),
  ];
  const isAllowed = (candidate: string) =>
    allowedRoots.some((root) => isPathInsideMount(candidate, root));
  const candidates = [
    ...(input.rememberedPath && isAllowed(input.rememberedPath)
      ? [input.rememberedPath]
      : []),
    ...input.quickAccess
      .map((entry) => entry.path)
      .filter(isAllowed),
    ...rootPaths,
    ...onlineMounts.map((mount) => mount.path),
  ];
  return [...new Set(candidates.filter((path): path is string => Boolean(path)))];
}
