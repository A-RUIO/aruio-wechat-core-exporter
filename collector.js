(function initCollector() {
  "use strict";

  const core = globalThis.ARUIOWechatCore;
  const PAGE_TIMEOUT_MS = 15000;
  const CONTENT_GROUPS = ["已通知内容", "未开启通知内容"];

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function getListTable() {
    return Array.from(document.querySelectorAll("table.weui-desktop-table")).find((table) =>
      table.offsetParent !== null &&
      Array.from(table.querySelectorAll("th")).some((cell) => cell.textContent.includes("内容标题")),
    );
  }

  function getPager() {
    const nums = Array.from(document.querySelectorAll(".weui-desktop-pagination__num"))
      .filter((node) => node.offsetParent !== null)
      .map((node) => core.parseInteger(node.textContent))
      .filter((value) => value !== null);
    return { current: nums[0] || 1, total: nums[1] || 1 };
  }

  function getPageSignature() {
    const table = getListTable();
    if (!table) return "";
    return Array.from(table.querySelectorAll('a[href*="detailpage"]'))
      .map((anchor) => core.articleIdFromHref(anchor.getAttribute("href")))
      .filter(Boolean)
      .join("|");
  }

  function pageButton(label) {
    return Array.from(document.querySelectorAll(".weui-desktop-pagination a")).find(
      (node) => core.normalizeText(node.textContent) === label && node.offsetParent !== null,
    );
  }

  function contentGroupCandidates(label) {
    return Array.from(document.querySelectorAll("a,button,[role='tab'],li,div,span"))
      .filter((node) => node.offsetParent !== null && core.normalizeText(node.textContent) === label)
      .sort((a, b) => a.children.length - b.children.length);
  }

  function actionableContentGroupNode(label) {
    const node = contentGroupCandidates(label)[0];
    if (!node) return null;
    return node.closest("a,button,[role='tab'],li") || node;
  }

  function nodeLooksActive(node) {
    for (let current = node; current && current !== document.body; current = current.parentElement) {
      if (current.getAttribute("aria-selected") === "true") return true;
      const classes = String(current.className || "");
      if (/(^|[\s_-])(active|selected|current)([\s_-]|$)/i.test(classes)) return true;
      if (current.matches(".weui-desktop-tab__navs")) break;
    }
    return false;
  }

  function getActiveContentGroup() {
    for (const label of CONTENT_GROUPS) {
      const node = actionableContentGroupNode(label);
      if (node && nodeLooksActive(node)) return label;
    }
    return "";
  }

  async function waitForContentGroup(label, previousSignature) {
    const started = Date.now();
    while (Date.now() - started < PAGE_TIMEOUT_MS) {
      await sleep(200);
      const active = getActiveContentGroup();
      const table = getListTable();
      const signature = getPageSignature();
      if (active === label && table) return;
      if (table && signature !== previousSignature && actionableContentGroupNode(label)?.contains(document.activeElement)) return;
    }
    throw new Error(`切换到“${label}”超时，请刷新公众号后台后重试。`);
  }

  async function switchContentGroup(label) {
    const node = actionableContentGroupNode(label);
    if (!node) throw new Error(`未找到“${label}”页签，公众号后台页面结构可能已变化。`);
    if (getActiveContentGroup() === label) return;
    const signature = getPageSignature();
    node.click();
    await waitForContentGroup(label, signature);
  }

  async function waitForPageChange(previousSignature, expectedPage) {
    const started = Date.now();
    while (Date.now() - started < PAGE_TIMEOUT_MS) {
      await sleep(200);
      const signature = getPageSignature();
      if (core.pageTransitionReady(previousSignature, signature, getPager().current, expectedPage)) return;
    }
    throw new Error("文章列表翻页超时，请刷新公众号后台后重试。");
  }

  async function moveOnePage(label) {
    const button = pageButton(label);
    if (!button) throw new Error(`找不到“${label}”按钮。`);
    const signature = getPageSignature();
    const currentPage = getPager().current;
    const expectedPage = label === "下一页" ? currentPage + 1 : currentPage - 1;
    button.click();
    await waitForPageChange(signature, expectedPage);
  }

  function readVisibleRows(contentGroup) {
    const table = getListTable();
    if (!table) throw new Error(`未找到“${contentGroup}”的公众号文章数据表。`);
    return Array.from(table.querySelectorAll("tbody tr"))
      .map((row) => {
        const detail = row.querySelector('a[href*="detailpage"]');
        const cells = Array.from(row.querySelectorAll("td")).map((cell) => cell.innerText.trim());
        return core.parseListRow(cells, detail?.getAttribute("href"), contentGroup);
      })
      .filter(Boolean);
  }

  async function collectCurrentGroupRows(contentGroup) {
    const originalPage = getPager().current;
    const collected = [];
    try {
      while (getPager().current > 1) await moveOnePage("上一页");
      while (true) {
        collected.push(...readVisibleRows(contentGroup));
        const pager = getPager();
        if (pager.current >= pager.total) break;
        await moveOnePage("下一页");
      }
    } finally {
      try {
        while (getPager().current > originalPage) await moveOnePage("上一页");
        while (getPager().current < originalPage) await moveOnePage("下一页");
      } catch {
        // Restoring the user's original page is best-effort and does not affect the export.
      }
    }
    return collected;
  }

  async function collectAllListRows() {
    if (!/\/misc\/appmsganalysis/.test(location.pathname)) {
      throw new Error("请先打开“数据分析 → 内容分析”，再点击导出。");
    }
    if (!getListTable()) throw new Error("文章列表还没有加载完成，请稍后重试。");

    const originalGroup = getActiveContentGroup();
    const collected = [];
    try {
      for (const contentGroup of CONTENT_GROUPS) {
        await switchContentGroup(contentGroup);
        collected.push(...(await collectCurrentGroupRows(contentGroup)));
      }
    } finally {
      if (originalGroup && originalGroup !== getActiveContentGroup()) {
        try {
          await switchContentGroup(originalGroup);
        } catch {
          // Restoring the user's original tab is best-effort and does not affect the export.
        }
      }
    }
    return core.mergeRowsByArticleId(collected);
  }

  function parseDetailDocument(doc) {
    const bodyText = doc.body?.textContent || "";
    const sources = Array.from(doc.scripts)
      .filter((script) => /window\.wx\.cgiData\s*=/.test(script.textContent || ""))
      .map((script) => script.textContent || "");
    const embedded = core.parseFirstEmbeddedCgiData(sources);
    if (embedded) {
      const updateMatch = bodyText.match(/页面数据更新至\s*(20\d{2}[\/-]\d{1,2}[\/-]\d{1,2})/);
      if (updateMatch) embedded.dataThroughDate = core.normalizeDate(updateMatch[1]);
      return embedded;
    }

    const tips = Array.from(doc.querySelectorAll(".bottom_data_tips")).map((node) => ({
      label: node.querySelector(".tips_name")?.textContent || "",
      value: node.querySelector(".tips_val_num")?.textContent || "",
    }));

    const interactionTitle = Array.from(doc.querySelectorAll(".data_list.top_data_list")).find(
      (node) => core.normalizeText(node.textContent) === "互动",
    );
    const interactionRows = interactionTitle
      ? Array.from(interactionTitle.parentElement.children)
          .filter((node) => node.classList.contains("data_list") && !node.classList.contains("top_data_list"))
          .map((node) => ({
            label: node.querySelector(".list_left")?.textContent || "",
            value: node.querySelector(".data_num")?.textContent || "",
          }))
      : [];
    return core.parseDetailParts(tips, interactionRows, bodyText);
  }

  async function collectDetail(row) {
    const response = await fetch(row.detailHref, core.detailFetchOptions());
    if (!response.ok) throw new Error(`详情请求失败：HTTP ${response.status}`);
    const html = await response.text();
    const doc = new DOMParser().parseFromString(html, "text/html");
    const detail = parseDetailDocument(doc);
    if (detail.readPeople === null) {
      const text = doc.body?.textContent || "";
      if (/扫码登录|登录公众平台|loginpage/i.test(`${response.url}\n${text}`)) {
        throw new Error("公众号登录已失效，请重新登录后再导出。");
      }
      throw new Error("详情页结构已变化，未识别到核心数据。");
    }
    return detail;
  }

  function localIsoDateTime(date) {
    const pad = (value) => String(value).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  }

  async function collect() {
    const listRows = await collectAllListRows();
    if (!listRows.length) throw new Error("当前日期范围内没有可导出的文章。");
    const collectedDate = new Date();
    const collectedAt = localIsoDateTime(collectedDate);
    const output = [];

    for (const row of listRows) {
      let detail = {};
      let status = "成功";
      let note = "";
      try {
        detail = await collectDetail(row);
        if (detail.limitedTo30Days) note = "公众号详情页仅统计发表后30天内的数据";
      } catch (error) {
        status = "部分成功";
        note = error instanceof Error ? error.message : "详情采集失败";
      }

      output.push({
        platform: row.platform,
        contentGroup: row.contentGroup,
        articleId: row.articleId,
        title: row.title,
        publishDate: row.publishDate,
        collectedAt,
        dataThroughDate: detail.dataThroughDate || "",
        ageDays: core.daysSincePublish(row.publishDate, collectedDate),
        readPeople: detail.readPeople ?? row.readPeople,
        averageReadMinutes: detail.averageReadMinutes ?? null,
        sharePeople: detail.sharePeople ?? row.sharePeople,
        newFollowers: detail.newFollowers ?? row.newFollowers,
        wowCount: detail.wowCount ?? null,
        likeCount: detail.likeCount ?? null,
        commentCount: detail.commentCount ?? null,
        favoriteCount: detail.favoriteCount ?? null,
        status,
        note,
      });
      await sleep(120);
    }

    output.sort((a, b) => b.publishDate.localeCompare(a.publishDate) || a.articleId.localeCompare(b.articleId));
    return { rows: output, csv: core.buildCsv(output) };
  }

  function saveCsv(csv) {
    const date = new Date();
    const pad = (value) => String(value).padStart(2, "0");
    const stamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `ARUIO-公众号核心数据-${stamp}.csv`;
    anchor.style.display = "none";
    document.documentElement.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function installPageButton() {
    if (window.top !== window || document.getElementById("aruio-wechat-exporter")) return;
    if (location.hostname !== "mp.weixin.qq.com") return;

    const host = document.createElement("div");
    host.id = "aruio-wechat-exporter";
    host.style.cssText = "position:fixed;right:24px;bottom:96px;z-index:2147483647";
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `
      <style>
        button{border:0;border-radius:8px;padding:10px 14px;background:#1769e0;color:#fff;font:600 14px/1.4 'Microsoft YaHei',Arial,sans-serif;box-shadow:0 4px 16px rgba(21,53,96,.24);cursor:pointer}
        button:hover{background:#1258bd}button:disabled{opacity:.7;cursor:wait}
        .msg{display:none;max-width:260px;margin-top:8px;padding:8px 10px;border-radius:6px;background:#fff;color:#344054;font:12px/1.45 'Microsoft YaHei',Arial,sans-serif;box-shadow:0 4px 16px rgba(21,53,96,.18)}
        .msg.show{display:block}.msg.error{color:#b42318}
      </style>
      <button type="button">导出核心数据</button><div class="msg" role="status"></div>`;
    document.documentElement.appendChild(host);

    const button = shadow.querySelector("button");
    const message = shadow.querySelector(".msg");
    button.addEventListener("click", async () => {
      button.disabled = true;
      button.textContent = "正在采集…";
      message.className = "msg show";
      message.textContent = "正在遍历两个内容页签并读取文章详情，请保持页面打开。";
      try {
        const result = await collect();
        saveCsv(result.csv);
        const partial = result.rows.filter((row) => row.status !== "成功").length;
        message.className = partial ? "msg show error" : "msg show";
        message.textContent = `已导出 ${result.rows.length} 篇${partial ? `，${partial} 篇详情未完整读取` : ""}。`;
      } catch (error) {
        message.className = "msg show error";
        message.textContent = error instanceof Error ? error.message : String(error);
      } finally {
        button.disabled = false;
        button.textContent = "导出核心数据";
      }
    });
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "ARUIO_EXPORT_WECHAT") return false;
    collect()
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    return true;
  });

  installPageButton();
})();
