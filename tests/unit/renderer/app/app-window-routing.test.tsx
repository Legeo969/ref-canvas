// @vitest-environment jsdom

import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "../../../../src/renderer/app/App";
import { useAppStore } from "../../../../src/renderer/app/store";
import { DialogProvider } from "../../../../src/renderer/components/DialogProvider";

const BOARD_ID = "123e4567-e89b-12d3-a456-426614174000";

describe("App auxiliary-window routing", () => {
  afterEach(() => {
    window.history.replaceState({}, "", "/");
  });

  it("renders a board window before the main workspace loading gate", () => {
    useAppStore.setState({ loading: true });
    window.history.replaceState(
      {},
      "",
      `/?board=${BOARD_ID}&mode=window`,
    );

    const html = renderToString(
      <DialogProvider>
        <App />
      </DialogProvider>,
    );

    expect(html).toContain("正在加载白板");
    expect(html).not.toContain("正在打开磁盘工作区");
  });
});
