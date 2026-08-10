const WINDOWS_PROTECTED_DIRECTORIES = new Set([
  "$recycle.bin",
  "system volume information",
]);

/** Windows-managed folders are never useful as media browsing targets. */
export function isProtectedSystemDirectory(
  name: string,
  isDirectory: boolean,
): boolean {
  return isDirectory && WINDOWS_PROTECTED_DIRECTORIES.has(name.toLocaleLowerCase("en-US"));
}
