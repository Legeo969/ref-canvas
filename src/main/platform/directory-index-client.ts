import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { utilityProcess, type UtilityProcess } from "electron";
import type {
  DirectoryPage,
  DirectoryProgressSnapshot,
  DirectorySearchSnapshot,
} from "../../shared/contracts";

interface Reply {
  id?: string;
  ok?: boolean;
  page?: DirectoryPage;
  error?: string;
  type?: "progress" | "search-progress";
  progress?: DirectoryProgressSnapshot;
  search?: DirectorySearchSnapshot;
  selection?: { paths: string[]; nextOffset: number | null; total: number };
  location?: number | null;
  cancelled?: boolean;
}

export class DirectoryIndexClient {
  private child: UtilityProcess | null = null;
  private readonly pending = new Map<string, {
    resolve(value: unknown): void;
    reject(error: unknown): void;
  }>();
  private readonly events = new EventEmitter();

  constructor(
    private readonly workerPath: string,
    private readonly databasePath: string,
  ) {}

  onProgress(listener: (progress: DirectoryProgressSnapshot) => void): () => void {
    this.events.on("progress", listener);
    return () => this.events.off("progress", listener);
  }

  onSearchProgress(listener: (snapshot: DirectorySearchSnapshot) => void): () => void {
    this.events.on("search-progress", listener);
    return () => this.events.off("search-progress", listener);
  }

  startSearch(
    searchId: string,
    directoryPath: string,
    query: string,
    collapseSequences = true,
    extensions?: string[],
    favoritesOnly?: boolean,
    favoritePaths?: string[],
  ): Promise<DirectorySearchSnapshot> {
    return this.request<DirectorySearchSnapshot>({
      type: "start-search",
      searchId,
      directoryPath,
      query,
      collapseSequences,
      extensions,
      favoritesOnly,
      favoritePaths,
    });
  }

  searchPage(searchId: string, offset = 0, pageSize = 512): Promise<DirectoryPage> {
    return this.request<DirectoryPage>({
      type: "search-page",
      searchId,
      offset,
      pageSize,
    });
  }

  cancelSearch(searchId: string): Promise<boolean> {
    return this.request<boolean>({ type: "cancel-search", searchId });
  }

  list(
    directoryPath: string,
    offset = 0,
    pageSize = 512,
    collapseSequences = true,
    extensions?: string[],
    favoritesOnly?: boolean,
    favoritePaths?: string[],
  ): Promise<DirectoryPage> {
    const id = randomUUID();
    const child = this.ensureChild();
    const promise = new Promise<DirectoryPage>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
    });
    child.postMessage({
      id,
      type: "list",
      databasePath: this.databasePath,
      directoryPath,
      offset,
      pageSize,
      collapseSequences,
      extensions,
      favoritesOnly,
      favoritePaths,
    });
    return promise;
  }

  resolveSelection(
    directoryPath: string,
    revision: string,
    excludedPaths: string[],
    offset: number,
    pageSize = 1_000,
    extensions?: string[],
    favoritesOnly?: boolean,
    favoritePaths?: string[],
  ): Promise<{ paths: string[]; nextOffset: number | null; total: number }> {
    const id = randomUUID();
    const child = this.ensureChild();
    const promise = new Promise<{
      paths: string[];
      nextOffset: number | null;
      total: number;
    }>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
    });
    child.postMessage({
      id,
      type: "resolve-selection",
      databasePath: this.databasePath,
      directoryPath,
      revision,
      excludedPaths,
      offset,
      pageSize,
      extensions,
      favoritesOnly,
      favoritePaths,
    });
    return promise;
  }

  resolveSearchSelection(
    searchId: string,
    revision: string,
    excludedPaths: string[],
    offset: number,
    pageSize = 1_000,
  ): Promise<{ paths: string[]; nextOffset: number | null; total: number }> {
    return this.request({
      type: "resolve-search-selection",
      searchId,
      revision,
      excludedPaths,
      offset,
      pageSize,
    });
  }

  locate(
    directoryPath: string,
    entryPath: string,
    revision: string,
    favoritesOnly?: boolean,
    favoritePaths?: string[],
  ): Promise<number | null> {
    const id = randomUUID();
    const child = this.ensureChild();
    const promise = new Promise<number | null>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
    });
    child.postMessage({
      id,
      type: "locate",
      databasePath: this.databasePath,
      directoryPath,
      entryPath,
      revision,
      favoritesOnly,
      favoritePaths,
    });
    return promise;
  }

  async invalidate(directoryPath: string): Promise<void> {
    const child = this.ensureChild();
    child.postMessage({
      id: randomUUID(),
      type: "invalidate",
      databasePath: this.databasePath,
      directoryPath,
    });
  }

  close(): void {
    for (const pending of this.pending.values()) {
      pending.reject(new Error("DIRECTORY_WORKER_CLOSED"));
    }
    this.pending.clear();
    this.child?.kill();
    this.child = null;
    this.events.removeAllListeners();
  }

  private ensureChild(): UtilityProcess {
    if (this.child) return this.child;
    const child = utilityProcess.fork(this.workerPath, [], {
      serviceName: "RefCanvas Directory Index",
    });
    child.on("message", (message: unknown) => this.handleMessage(message as Reply));
    child.once("error", (error) => {
      if (this.child === child) this.child = null;
      for (const pending of this.pending.values()) pending.reject(error);
      this.pending.clear();
    });
    child.once("exit", () => {
      if (this.child === child) this.child = null;
      for (const pending of this.pending.values()) {
        pending.reject(new Error("DIRECTORY_WORKER_EXITED"));
      }
      this.pending.clear();
    });
    this.child = child;
    return child;
  }

  private request<T>(message: Record<string, unknown>): Promise<T> {
    const id = randomUUID();
    const child = this.ensureChild();
    const promise = new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
      });
    });
    child.postMessage({
      id,
      databasePath: this.databasePath,
      ...message,
    });
    return promise;
  }

  private handleMessage(message: Reply): void {
    if (message.type === "progress" && message.progress) {
      this.events.emit("progress", message.progress);
      return;
    }
    if (message.type === "search-progress" && message.search) {
      this.events.emit("search-progress", message.search);
      return;
    }
    if (!message.id) return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    if (
      !message.ok ||
      (!message.page &&
        !message.search &&
        !message.selection &&
        message.location === undefined &&
        message.cancelled === undefined)
    ) {
      pending.reject(new Error(message.error ?? "DIRECTORY_WORKER_FAILED"));
      return;
    }
    pending.resolve(
      message.page ??
        message.search ??
        message.selection ??
        message.location ??
        message.cancelled ??
        null,
    );
  }
}
