import {
  ipcMain,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  type WebFrameMain,
} from "electron";

export type IpcSenderValidator = (frame: WebFrameMain | null) => boolean;

export class SecureIpcRegistrar {
  constructor(private readonly validateSender: IpcSenderValidator) {}

  handle<TArgs extends unknown[], TResult>(
    channel: string,
    handler: (...args: TArgs) => TResult | Promise<TResult>,
  ): void {
    registerSecureHandle(this.validateSender, channel, handler);
  }

  handleWithEvent<TArgs extends unknown[], TResult>(
    channel: string,
    handler: (
      event: IpcMainInvokeEvent,
      ...args: TArgs
    ) => TResult | Promise<TResult>,
  ): void {
    registerSecureHandleWithEvent(this.validateSender, channel, handler);
  }

  on<TArgs extends unknown[]>(
    channel: string,
    listener: (event: IpcMainEvent, ...args: TArgs) => void,
  ): void {
    registerSecureListener(this.validateSender, channel, listener);
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
