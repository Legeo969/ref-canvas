import { z } from "zod";
import type { SecureIpcRegistrar } from "../platform/secure-ipc";
import type { BrowserCapturePairingService } from "../services/browser-capture-pairing-service";

export function registerBrowserCaptureIpc(
  ipc: SecureIpcRegistrar,
  getPairings: () => BrowserCapturePairingService,
): void {
  ipc.handle("browser-capture:create-pairing-code", () =>
    getPairings().createPairingCode(),
  );
  ipc.handle("browser-capture:list-pairings", () =>
    getPairings().listPairings(),
  );
  ipc.handle("browser-capture:revoke-pairing", (id) => {
    getPairings().revokePairing(z.string().uuid().parse(id));
  });
}
