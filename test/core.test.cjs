const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../lib/core.js");

test("parses a list row and removes no-data markers", () => {
  const row = core.parseListRow(
    [
      "翻身仗？Gemini 3.8让AI第一次能看懂视频？\n发表时间：2026-09-03",
      "279",
      "3",
      "0",
      "2.94%",
      "-",
      "详情",
    ],
    "/misc/appmsganalysis?action=detailpage&msgid=2247483880_1&token=placeholder&lang=zh_CN",
    "未开启通知内容",
  );
  assert.equal(row.contentGroup, "未开启通知内容");
  assert.equal(row.articleId, "2247483880_1");
  assert.equal(row.publishDate, "2026-09-03");
  assert.equal(row.readPeople, 279);
  assert.equal(row.newFollowers, 0);
  assert.equal(row.completionRate, "");
});

test("parses the detail KPI and interaction order", () => {
  const detail = core.parseDetailParts(
    [
      { label: "阅读", value: "1,036" },
      { label: "平均阅读时长", value: "0.77" },
      { label: "新增关注", value: "8" },
    ],
    [
      { label: "分享", value: "71" },
      { label: "", value: "3" },
      { label: "", value: "17" },
      { label: "留言", value: "10" },
      { label: "收藏", value: "40" },
    ],
    "本页面仅统计发表后30天内的数据 页面数据更新至2026/09/03",
  );
  assert.deepEqual(detail, {
    dataThroughDate: "2026-09-03",
    readPeople: 1036,
    averageReadMinutes: 0.77,
    newFollowers: 8,
    sharePeople: 71,
    wowCount: 3,
    likeCount: 17,
    commentCount: 10,
    favoriteCount: 40,
    limitedTo30Days: true,
  });
});

test("parses the embedded WeChat cgiData payload", () => {
  const detail = core.parseDetailCgiData(
    {
      article_data_new: {
        avg_article_read_time: 46,
        follow_after_read_uv: 8,
        zaikan_cnt: 3,
        like_cnt: 17,
        comment_cnt: 10,
        read_uv: 1036,
        share_uv: 71,
        collection_uv: 40,
      },
    },
    ["2026-08-22", "2026-09-03", "2026-09-02"],
  );
  assert.equal(detail.dataThroughDate, "2026-09-03");
  assert.equal(detail.averageReadMinutes, 0.77);
  assert.equal(detail.readPeople, 1036);
  assert.equal(detail.newFollowers, 8);
  assert.equal(detail.wowCount, 3);
  assert.equal(detail.favoriteCount, 40);
});

test("extracts embedded cgiData with quoted keys", () => {
  const detail = core.parseEmbeddedCgiData(`window.wx.cgiData = {
    "articleData": {"article_data_new":{"read_uv":62,"avg_article_read_time":90,"share_uv":1,"follow_after_read_uv":1,"zaikan_cnt":2,"like_cnt":3,"comment_cnt":4,"collection_uv":5}},
    "articleSummaryData": [{"ref_date":"2026-09-06"}]
  };`);
  assert.equal(detail.readPeople, 62);
  assert.equal(detail.averageReadMinutes, 1.5);
  assert.equal(detail.dataThroughDate, "2026-09-06");
  assert.equal(detail.favoriteCount, 5);
});

test("skips a bootstrap script and parses the later real cgiData script", () => {
  const detail = core.parseFirstEmbeddedCgiData([
    "if (!window.wx) window.wx = {}; /* window.wx.cgiData = assigned later */",
    `window.wx.cgiData = {
      trendSource: '',
      articleData: {"article_data_new":{"read_uv":62,"avg_article_read_time":37,"share_uv":1,"follow_after_read_uv":1,"zaikan_cnt":0,"like_cnt":0,"comment_cnt":0,"collection_uv":1}},
      articleSummaryData: {"list":[{"ref_date":"2026-09-05"}]}
    };`,
  ]);
  assert.equal(detail.readPeople, 62);
  assert.equal(detail.averageReadMinutes, 0.62);
  assert.equal(detail.favoriteCount, 1);
});

test("detail requests include the logged-in WeChat session", () => {
  assert.deepEqual(core.detailFetchOptions(), { credentials: "include", cache: "no-store" });
});

test("waits for both the page number and article rows before continuing", () => {
  assert.equal(core.pageTransitionReady("page-one-ids", "page-one-ids", 2, 2), false);
  assert.equal(core.pageTransitionReady("page-one-ids", "page-two-ids", 1, 2), false);
  assert.equal(core.pageTransitionReady("page-one-ids", "page-two-ids", 2, 2), true);
});

test("merges duplicate articles collected from both content tabs", () => {
  const rows = core.mergeRowsByArticleId([
    { articleId: "100_1", title: "A", contentGroup: "已通知内容", readPeople: 10 },
    { articleId: "200_1", title: "B", contentGroup: "未开启通知内容", readPeople: 20 },
    { articleId: "100_1", title: "A", contentGroup: "未开启通知内容", readPeople: 12 },
  ]);
  assert.equal(rows.length, 2);
  assert.equal(rows.find((row) => row.articleId === "100_1").contentGroup, "已通知内容/未开启通知内容");
  assert.equal(rows.find((row) => row.articleId === "100_1").readPeople, 12);
});

test("sanitizes session parameters from backend URLs", () => {
  const clean = core.sanitizeBackendUrl(
    "/misc/appmsganalysis?action=detailpage&msgid=1_1&token=placeholder&lang=zh_CN&pass_ticket=placeholder",
  );
  assert.equal(clean, "https://mp.weixin.qq.com/misc/appmsganalysis?action=detailpage&msgid=1_1");
});

test("CSV preserves zero and leaves missing values blank", () => {
  const csv = core.buildCsv([
    {
      platform: "公众号",
      articleId: "1_1",
      title: '标题里有,逗号和"引号"',
      publishDate: "2026-09-03",
      collectedAt: "2026-09-04 12:00:00",
      readPeople: 0,
      likeCount: null,
      status: "成功",
    },
  ]);
  assert.ok(csv.startsWith("\uFEFF平台,"));
  assert.ok(csv.startsWith("\uFEFF平台,内容分组,"));
  assert.ok(csv.includes('"标题里有,逗号和""引号"""'));
  assert.ok(csv.includes(",0,"));
});
