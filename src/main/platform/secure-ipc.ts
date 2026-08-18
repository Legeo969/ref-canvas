import {
  ipcMain,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  type WebFrameMain,
} from "electron";

export type IpcSenderValidator = (frame: WebFrameMain | null) => boolean;

/** 可选：每次合法 IPC 调用时回调（用于 idle 检测 / 节流后台工作）。 */
export type IpcActivityHook = () => void;

export class SecureIpcRegistrar {
  constructor(
    private readonly validateSender: IpcSenderValidator,
    private readonly onActivity?: IpcActivityHook,
  ) {}

  private activity(): void {
    this.onActivity?.();
  }

  handle<TArgs extends unknown[], TResult>(
    channel: string,
    handler: (...args: TArgs) => TResult | Promise<TResult>,
  ): void {
    registerSecureHandle(this.validateSender, channel, (...args: TArgs) => {
      this.activity();
      return handler(...args);
    });
  }

  handleWithEvent<TArgs extends unknown[], TResult>(
    channel: string,
    handler: (
      event: IpcMainInvokeEvent,
      ...args: TArgs
    ) => TResult | Promise<TResult>,
  ): void {
    registerSecureHandleWithEvent(this.validateSender, channel, (event, ...args: TArgs) => {
      this.activity();
      return handler(event, ...args);
    });
  }

  on<TArgs extends unknown[]>(
    channel: string,
    listener: (event: IpcMainEvent, ...args: TArgs) => void,
  ): void {
    registerSecureListener(this.validateSender, channel, (event, ...args: TArgs) => {
      this.activity();
      listener(event, ...args);
    });
  }
}

export function registerSecureHandle<TArgs extends unknown[], TResult>(
  validateSender: IpcSenderValidator,
  channel: string,
  handler: (...args: TArgs) => TResult | Promise<TResult>,
): void {
  ipcMain.handle(channel, async (event, ...args: TArgs) => {
    if (!validateSender(event.senderFrame)) {
      throw new Error("INVALID_IPC_SENDER");
    }
    return handler(...args);
  });
}

export function registerSecureHandleWithEvent<
  TArgs extends unknown[],
  TResult,
>(
  validateSender: IpcSenderValidator,
  channel: string,
  handler: (
    event: IpcMainInvokeEvent,
    ...args: TArgs
  ) => TResult | Promise<TResult>,
): void {
  ipcMain.handle(channel, async (event, ...args: TArgs) => {
    if (!validateSender(event.senderFrame)) {
      throw new Error("INVALID_IPC_SENDER");
    }
    return handler(event, ...args);
  });
}

export function registerSecureListener<TArgs extends unknown[]>(
  validateSender: IpcSenderValidator,
  channel: string,
  listener: (event: IpcMainEvent, ...args: TArgs) => void,
): void {
  ipcMain.on(channel, (event, ...args: TArgs) => {
    if (!validateSender(event.senderFrame)) return;
    listener(event, ...args);
  });
}
