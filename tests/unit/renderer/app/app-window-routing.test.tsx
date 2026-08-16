// @vitest-environment jsdom

import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "../../../../src/renderer/app/App";
import { useAppStore } from "../../../../src/renderer/app/store";
import { DialogProvider } from "../../../../src/renderer/components/DialogProvider";
import { setLanguage } from "../../../../src/renderer/app/i18n";

const BOARD_ID = "123e4567-e89b-12d3-a456-426614174000";

setLanguage("zh-CN"); // 白板加载文案已迁移到 i18n；断言基于简体中文。

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
