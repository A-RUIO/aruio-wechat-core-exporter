(function initPopup() {
  "use strict";

  const button = document.getElementById("export");
  const status = document.getElementById("status");

  function setStatus(text, kind = "") {
    status.textContent = text;
    status.className = kind;
  }

  function dateStamp() {
    const date = new Date();
    const pad = (value) => String(value).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  function downloadCsv(csv) {
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `ARUIO-公众号核心数据-${dateStamp()}.csv`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  button.addEventListener("click", async () => {
    button.disabled = true;
    setStatus("正在遍历两个内容页签并读取文章详情，请勿关闭此窗口……");
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id || !String(tab.url || "").startsWith("https://mp.weixin.qq.com/")) {
        throw new Error("当前页面不是微信公众号后台。");
      }
      const response = await chrome.tabs.sendMessage(tab.id, { type: "ARUIO_EXPORT_WECHAT" });
      if (!response?.ok) throw new Error(response?.error || "采集失败，请刷新页面后重试。");
      downloadCsv(response.csv);
      const partial = response.rows.filter((row) => row.status !== "成功").length;
      setStatus(`已导出 ${response.rows.length} 篇${partial ? `，其中 ${partial} 篇详情未完整读取` : ""}。`, partial ? "error" : "success");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const friendly = /Receiving end does not exist|Could not establish connection/.test(message)
        ? "扩展刚加载时需刷新一次公众号页面，然后重试。"
        : message;
      setStatus(friendly, "error");
    } finally {
      button.disabled = false;
    }
  });
})();
