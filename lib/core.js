(function initCore(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.ARUIOWechatCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function buildCore() {
  "use strict";

  function normalizeText(value) {
    return String(value ?? "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
  }

  function parseInteger(value) {
    const text = normalizeText(value).replace(/,/g, "");
    if (!text || text === "-") return null;
    const match = text.match(/-?\d+(?:\.\d+)?/);
    return match ? Number.parseInt(match[0], 10) : null;
  }

  function parseDecimal(value) {
    const text = normalizeText(value).replace(/,/g, "");
    if (!text || text === "-") return null;
    const match = text.match(/-?\d+(?:\.\d+)?/);
    return match ? Number.parseFloat(match[0]) : null;
  }

  function normalizeDate(value) {
    const match = String(value ?? "").match(/(20\d{2})[\/-](\d{1,2})[\/-](\d{1,2})/);
    if (!match) return "";
    return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
  }

  function articleIdFromHref(href) {
    try {
      const url = new URL(href, "https://mp.weixin.qq.com/");
      return url.searchParams.get("msgid") || "";
    } catch {
      return "";
    }
  }

  function sanitizeBackendUrl(href) {
    try {
      const url = new URL(href, "https://mp.weixin.qq.com/");
      for (const key of ["token", "lang", "auth", "key", "pass_ticket"]) {
        url.searchParams.delete(key);
      }
      return `${url.origin}${url.pathname}${url.search}`;
    } catch {
      return "";
    }
  }

  function parseListRow(cells, detailHref, contentGroup = "") {
    if (!Array.isArray(cells) || cells.length < 7 || !detailHref) return null;
    const titleCell = String(cells[0] ?? "");
    const title = normalizeText(titleCell.replace(/发表时间[：:]\s*20\d{2}[\/-]\d{1,2}[\/-]\d{1,2}.*/s, ""));
    const publishDate = normalizeDate(titleCell);
    const articleId = articleIdFromHref(detailHref);
    if (!title || !publishDate || !articleId) return null;
    return {
      platform: "公众号",
      contentGroup: normalizeText(contentGroup),
      articleId,
      title,
      publishDate,
      readPeople: parseInteger(cells[1]),
      sharePeople: parseInteger(cells[2]),
      newFollowers: parseInteger(cells[3]),
      deliveryReadRate: normalizeText(cells[4]) === "-" ? "" : normalizeText(cells[4]),
      completionRate: normalizeText(cells[5]) === "-" ? "" : normalizeText(cells[5]),
      detailHref,
    };
  }

  function parseDetailParts(tips, interactions, bodyText) {
    const tipMap = Object.fromEntries((tips || []).map((item) => [normalizeText(item.label), item.value]));
    const named = {};
    const unlabeled = [];
    for (const item of interactions || []) {
      const label = normalizeText(item.label);
      const value = parseInteger(item.value);
      if (label) named[label] = value;
      else unlabeled.push(value);
    }
    const updateMatch = String(bodyText ?? "").match(/页面数据更新至\s*(20\d{2}[\/-]\d{1,2}[\/-]\d{1,2})/);
    const limitedTo30Days = /仅统计发表后30天内的数据/.test(String(bodyText ?? ""));
    return {
      dataThroughDate: updateMatch ? normalizeDate(updateMatch[1]) : "",
      readPeople: parseInteger(tipMap["阅读"]),
      averageReadMinutes: parseDecimal(tipMap["平均阅读时长"]),
      newFollowers: parseInteger(tipMap["新增关注"]),
      sharePeople: named["分享"] ?? null,
      wowCount: unlabeled[0] ?? null,
      likeCount: unlabeled[1] ?? null,
      commentCount: named["留言"] ?? null,
      favoriteCount: named["收藏"] ?? null,
      limitedTo30Days,
    };
  }

  function parseDetailCgiData(articleData, refDates) {
    const metrics = articleData?.article_data_new || {};
    const dates = (refDates || []).map(normalizeDate).filter(Boolean).sort();
    const seconds = parseDecimal(metrics.avg_article_read_time);
    return {
      dataThroughDate: dates.at(-1) || "",
      readPeople: parseInteger(metrics.read_uv),
      averageReadMinutes: seconds === null ? null : Math.round((seconds / 60) * 100) / 100,
      newFollowers: parseInteger(metrics.follow_after_read_uv),
      sharePeople: parseInteger(metrics.share_uv),
      wowCount: parseInteger(metrics.zaikan_cnt),
      likeCount: parseInteger(metrics.like_cnt),
      commentCount: parseInteger(metrics.comment_cnt),
      favoriteCount: parseInteger(metrics.collection_uv),
      limitedTo30Days: true,
    };
  }

  function parseEmbeddedCgiData(source) {
    const text = String(source ?? "");
    const articleMatch = text.match(
      /["']?articleData["']?\s*:\s*(\{[\s\S]*?\})\s*,\s*["']?articleSummaryData["']?\s*:/,
    );
    if (!articleMatch) return null;
    try {
      const articleData = JSON.parse(articleMatch[1]);
      const refDates = Array.from(text.matchAll(/["']ref_date["']\s*:\s*["'](20\d{2}-\d{2}-\d{2})["']/g), (match) =>
        match[1],
      );
      return parseDetailCgiData(articleData, refDates);
    } catch {
      return null;
    }
  }

  function parseFirstEmbeddedCgiData(sources) {
    for (const source of sources || []) {
      const parsed = parseEmbeddedCgiData(source);
      if (parsed) return parsed;
    }
    return null;
  }

  function detailFetchOptions() {
    return { credentials: "include", cache: "no-store" };
  }

  function pageTransitionReady(previousSignature, currentSignature, currentPage, expectedPage) {
    return Boolean(
      currentSignature &&
        currentSignature !== previousSignature &&
        Number(currentPage) === Number(expectedPage),
    );
  }

  function mergeRowsByArticleId(rows) {
    const merged = new Map();
    for (const row of rows || []) {
      if (!row?.articleId) continue;
      const previous = merged.get(row.articleId);
      if (!previous) {
        merged.set(row.articleId, { ...row });
        continue;
      }
      const groups = [previous.contentGroup, row.contentGroup]
        .flatMap((value) => normalizeText(value).split("/").filter(Boolean));
      merged.set(row.articleId, {
        ...previous,
        ...row,
        contentGroup: Array.from(new Set(groups)).join("/"),
      });
    }
    return Array.from(merged.values());
  }

  function daysSincePublish(publishDate, collectedAt) {
    const published = new Date(`${publishDate}T00:00:00`);
    const collected = new Date(collectedAt);
    if (Number.isNaN(published.getTime()) || Number.isNaN(collected.getTime())) return null;
    return Math.max(0, Math.floor((collected.getTime() - published.getTime()) / 86400000));
  }

  function escapeCsv(value) {
    if (value === null || value === undefined) return "";
    const text = String(value);
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }

  const exportColumns = [
    ["平台", "platform"],
    ["内容分组", "contentGroup"],
    ["平台作品ID", "articleId"],
    ["标题", "title"],
    ["发布日期", "publishDate"],
    ["采集时间", "collectedAt"],
    ["数据截止日期", "dataThroughDate"],
    ["发布后天数", "ageDays"],
    ["阅读人数", "readPeople"],
    ["平均阅读时长(分钟)", "averageReadMinutes"],
    ["分享人数", "sharePeople"],
    ["新增关注", "newFollowers"],
    ["在看", "wowCount"],
    ["点赞", "likeCount"],
    ["留言", "commentCount"],
    ["收藏", "favoriteCount"],
    ["采集状态", "status"],
    ["备注", "note"],
  ];

  function buildCsv(rows) {
    const lines = [exportColumns.map(([label]) => escapeCsv(label)).join(",")];
    for (const row of rows) {
      lines.push(exportColumns.map(([, key]) => escapeCsv(row[key])).join(","));
    }
    return `\uFEFF${lines.join("\r\n")}`;
  }

  return {
    normalizeText,
    parseInteger,
    parseDecimal,
    normalizeDate,
    articleIdFromHref,
    sanitizeBackendUrl,
    parseListRow,
    parseDetailParts,
    parseDetailCgiData,
    parseEmbeddedCgiData,
    parseFirstEmbeddedCgiData,
    detailFetchOptions,
    pageTransitionReady,
    mergeRowsByArticleId,
    daysSincePublish,
    escapeCsv,
    buildCsv,
    exportColumns,
  };
});
