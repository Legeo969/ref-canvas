/**
 * RefCanvas 页面拾取器（注入式 content script，ISOLATED world，主框架）。
 *
 * 交互：悬浮高亮可捕获元素（img/video/canvas/背景图）→ 点击加入/移出
 * 选择集 → 工具条"捕获"逐项发送到 RefCanvas，Esc 退出。
 * 再注入一次（重复点图标/快捷键）等效"退出"。
 *
 * 设计取舍：只注入主框架——iframe 内图片仍可用右键菜单捕获；多框架
 * 选择集聚合的复杂度对 v1 不划算。
 */
(() => {
  const ROOT_FLAG = "__refcanvasPicker";

  if (window[ROOT_FLAG]) {
    window[ROOT_FLAG].teardown("已退出拾取模式");
    return;
  }

  const MAX_VISIBLE_SELECT = 30;
  const MIN_SIDE_PX = 40;

  const overlay = document.createElement("div");
  overlay.className = "rc-picker-root";
  overlay.dataset.refcanvasPicker = "root";

  const highlight = document.createElement("div");
  highlight.className = "rc-picker-highlight";
  const tag = document.createElement("div");
  tag.className = "rc-picker-tag";

  const banner = document.createElement("div");
  banner.className = "rc-picker-banner";

  const toolbar = document.createElement("div");
  toolbar.className = "rc-picker-toolbar";
  toolbar.dataset.refcanvasPicker = "toolbar";
  const countLabel = document.createElement("span");
  countLabel.className = "rc-count";
  countLabel.textContent = "已选 0 张";
  const btnSelectAll = document.createElement("button");
  btnSelectAll.textContent = "全选可见图片";
  const btnCapture = document.createElement("button");
  btnCapture.className = "rc-primary";
  btnCapture.textContent = "捕获";
  btnCapture.disabled = true;
  const btnExit = document.createElement("button");
  btnExit.textContent = "退出 (Esc)";
  toolbar.append(countLabel, btnSelectAll, btnCapture, btnExit);

  overlay.append(highlight, tag, banner, toolbar);
  document.documentElement.appendChild(overlay);

  /** key（url 或元素）→ {item, chip} */
  const selected = new Map();
  let hovered = null;
  let busy = false;
  let tornDown = false;

  const isOwnUi = (el) =>
    el instanceof Element && el.closest("[data-refcanvas-picker]") != null;

  function showBanner(text, isError, autoHideMs) {
    banner.textContent = text;
    banner.className = `rc-picker-banner${isError ? " rc-error" : ""}`;
    banner.style.display = "block";
    if (autoHideMs) {
      setTimeout(() => {
        if (banner.textContent === text) banner.style.display = "none";
      }, autoHideMs);
    }
  }

  /** 解析 srcset 取最大分辨率候选 URL。 */
  function bestSrcsetUrl(el) {
    const attr = el.getAttribute("srcset") || el.getAttribute("data-srcset");
    if (!attr) return null;
    let best = null;
    let bestWidth = -1;
    for (const part of attr.split(",")) {
      const [url, descriptor] = part.trim().split(/\s+/);
      const width = descriptor?.endsWith("w")
        ? Number(descriptor.slice(0, -1)) || 0
        : descriptor?.endsWith("x")
          ? (Number(descriptor.slice(0, -1)) || 1) * 1000
          : 1000;
      if (width > bestWidth) {
        bestWidth = width;
        best = url;
      }
    }
    return best;
  }

  function absoluteUrl(url) {
    try {
      return new URL(url, location.href).href;
    } catch {
      return null;
    }
  }

  function selectionKey(candidate) {
    return candidate.kind === "url" ? candidate.url : candidate.el;
  }

  /** 从命中元素向上找可捕获目标（最多 6 层），返回描述或 null。 */
  function resolveCandidate(startEl) {
    let el = startEl;
    for (let depth = 0; el && depth < 6; depth += 1, el = el.parentElement) {
      if (isOwnUi(el)) return null;
      const rect = el.getBoundingClientRect();
      if (rect.width < MIN_SIDE_PX || rect.height < MIN_SIDE_PX) continue;

      if (el instanceof HTMLImageElement && (el.currentSrc || el.src)) {
        const url = absoluteUrl(bestSrcsetUrl(el) || el.currentSrc || el.src);
        if (!url) continue;
        return {
          kind: "url",
          url,
          alt: el.alt || el.title || "",
          box: rect,
          label: `${el.naturalWidth || "?"}×${el.naturalHeight || "?"}`,
        };
      }
      if (el instanceof HTMLVideoElement && el.videoWidth > 0) {
        return {
          kind: "video",
          el,
          alt: el.title || "",
          box: rect,
          label: `视频帧 ${el.videoWidth}×${el.videoHeight}`,
        };
      }
      if (el instanceof HTMLCanvasElement && el.width > 0) {
        return {
          kind: "canvas",
          el,
          box: rect,
          label: `画布 ${el.width}×${el.height}`,
        };
      }
      const style = getComputedStyle(el);
      const match = style.backgroundImage?.match(/url\(["']?([^"')]+)["']?\)/);
      if (match) {
        const url = absoluteUrl(match[1]);
        if (url) {
          return {
            kind: "url",
            url,
            alt: el.getAttribute("aria-label") || el.title || "",
            box: rect,
            label: "背景图",
          };
        }
      }
    }
    return null;
  }

  function positionChip(chip, rect) {
    chip.style.left = `${Math.max(0, rect.left)}px`;
    chip.style.top = `${Math.max(0, rect.top)}px`;
  }

  /** 统一重渲染选中态：角标编号 + 位置 + 工具条计数。 */
  function renderSelection() {
    let index = 1;
    for (const record of selected.values()) {
      record.chip.textContent = String(index);
      if (record.item.el) {
        positionChip(record.chip, record.item.el.getBoundingClientRect());
      }
      index += 1;
    }
    countLabel.textContent = `已选 ${selected.size} 张`;
    btnCapture.disabled = selected.size === 0 || busy;
    btnCapture.textContent = busy
      ? "发送中…"
      : selected.size > 0
        ? `捕获 ${selected.size} 张`
        : "捕获";
  }

  function toggleSelection(candidate) {
    const key = selectionKey(candidate);
    if (selected.has(key)) {
      selected.get(key).chip.remove();
      selected.delete(key);
    } else {
      const chip = document.createElement("div");
      chip.className = "rc-picker-chip";
      positionChip(chip, candidate.box);
      overlay.appendChild(chip);
      selected.set(key, { item: candidate, chip });
    }
    renderSelection();
  }

  /** video/canvas 抽帧 → dataURL；被跨域污染的画布无法导出。 */
  function extractFrame(candidate) {
    const source =
      candidate.kind === "video"
        ? {
            el: candidate.el,
            w: candidate.el.videoWidth,
            h: candidate.el.videoHeight,
          }
        : { el: candidate.el, w: candidate.el.width, h: candidate.el.height };
    const canvas = document.createElement("canvas");
    canvas.width = source.w;
    canvas.height = source.h;
    const context = canvas.getContext("2d");
    if (!context) return { error: "无法创建画布上下文" };
    context.drawImage(source.el, 0, 0);
    try {
      return { dataUrl: canvas.toDataURL("image/png") };
    } catch {
      return { error: "该画布/视频受跨域保护，无法导出当前帧" };
    }
  }

  async function sendSelection() {
    if (selected.size === 0 || busy) return;
    busy = true;
    renderSelection();
    const items = [];
    const localFailures = [];
    for (const record of selected.values()) {
      const item = record.item;
      if (item.kind === "url") {
        items.push({ kind: "url", url: item.url, alt: item.alt });
      } else {
        const frame = extractFrame(item);
        if (frame.error) {
          localFailures.push({ alt: item.label, error: frame.error });
        } else {
          items.push({
            kind: "frame",
            dataUrl: frame.dataUrl,
            suggestedName: `${item.kind}-frame-${Date.now()}.png`,
            alt: item.alt || item.label,
          });
        }
      }
    }

    let summary = null;
    if (items.length > 0) {
      try {
        const response = await chrome.runtime.sendMessage({
          type: "PICKER_CAPTURE",
          items,
          pageUrl: location.href,
          pageTitle: document.title || "",
        });
        const okCount = response?.okCount ?? 0;
        const failCount = (response?.failures?.length ?? 0) + localFailures.length;
        summary = `已发送 ${okCount} 张到 RefCanvas${failCount > 0 ? `，失败 ${failCount} 张（弹窗可重试）` : ""}`;
        showBanner(summary, failCount > 0, 2600);
      } catch (error) {
        summary = `发送失败：${String(error?.message ?? error)}`;
        showBanner(summary, true, 3200);
      }
    } else if (localFailures.length > 0) {
      summary = localFailures[0].error;
      showBanner(summary, true, 3200);
    }

    if (localFailures.length === 0) {
      // 给用户一点看到结果的时间再收场；发送失败时横幅同样会展示。
      setTimeout(() => teardown(summary || "已退出拾取模式"), 1500);
    } else {
      busy = false;
      renderSelection();
    }
  }

  function selectVisibleImages() {
    let added = 0;
    for (const el of document.querySelectorAll("img,video")) {
      if (selected.size >= MAX_VISIBLE_SELECT) {
        showBanner(`一次最多选 ${MAX_VISIBLE_SELECT} 张`, true, 2400);
        break;
      }
      const rect = el.getBoundingClientRect();
      const inViewport =
        rect.top >= -MIN_SIDE_PX &&
        rect.left >= -MIN_SIDE_PX &&
        rect.top < window.innerHeight &&
        rect.left < window.innerWidth &&
        rect.width >= MIN_SIDE_PX &&
        rect.height >= MIN_SIDE_PX;
      if (!inViewport) continue;
      const candidate = resolveCandidate(el);
      if (!candidate || selected.has(selectionKey(candidate))) continue;
      toggleSelection(candidate);
      added += 1;
    }
    if (added === 0) showBanner("当前视口里没有新的可捕获图片", true, 2400);
  }

  function onPointerMove(event) {
    if (busy) return;
    const target = document.elementFromPoint(event.clientX, event.clientY);
    if (!target || isOwnUi(target)) {
      hideHover();
      return;
    }
    const candidate = resolveCandidate(target);
    if (!candidate) {
      hideHover();
      return;
    }
    hovered = candidate;
    const box = candidate.box;
    highlight.style.left = `${box.left - 2}px`;
    highlight.style.top = `${box.top - 2}px`;
    highlight.style.width = `${box.width + 4}px`;
    highlight.style.height = `${box.height + 4}px`;
    highlight.className = `rc-picker-highlight${
      selected.has(selectionKey(candidate)) ? " is-selected" : ""
    }`;
    highlight.style.display = "block";
    tag.textContent = `${
      selected.has(selectionKey(candidate)) ? "已选 · " : ""
    }${candidate.label}`;
    tag.style.left = `${box.left}px`;
    tag.style.top = `${box.top - 2}px`;
    tag.style.display = "block";
  }

  function hideHover() {
    hovered = null;
    highlight.style.display = "none";
    tag.style.display = "none";
  }

  function onClick(event) {
    if (busy) return;
    if (isOwnUi(event.target)) return;
    const candidate =
      hovered ??
      resolveCandidate(document.elementFromPoint(event.clientX, event.clientY));
    if (candidate) {
      event.preventDefault();
      event.stopPropagation();
      toggleSelection(candidate);
    }
  }

  function onKeyDown(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      teardown("已退出拾取模式");
    }
  }

  function onUnload() {
    teardown();
  }

  function teardown(message) {
    if (tornDown) return;
    tornDown = true;
    window.removeEventListener("mousemove", onPointerMove, true);
    window.removeEventListener("click", onClick, true);
    window.removeEventListener("keydown", onKeyDown, true);
    window.removeEventListener("scroll", renderSelection, true);
    window.removeEventListener("resize", renderSelection, true);
    window.removeEventListener("pagehide", onUnload, true);
    overlay.remove();
    delete window[ROOT_FLAG];
    if (message) console.info(`[RefCanvas] ${message}`);
  }

  window.addEventListener("mousemove", onPointerMove, true);
  window.addEventListener("click", onClick, true);
  window.addEventListener("keydown", onKeyDown, true);
  window.addEventListener("scroll", renderSelection, true);
  window.addEventListener("resize", renderSelection, true);
  window.addEventListener("pagehide", onUnload, true);

  btnCapture.addEventListener("click", () => void sendSelection());
  btnExit.addEventListener("click", () => teardown("已退出拾取模式"));
  btnSelectAll.addEventListener("click", selectVisibleImages);

  window[ROOT_FLAG] = { teardown };
  showBanner("拾取模式：悬浮点选图片，可多选，完成后点「捕获」", false, 3600);
})();
