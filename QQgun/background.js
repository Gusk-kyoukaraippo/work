chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.type !== "download" || !message.filename) {
    return false;
  }

  const mime = message.mime || "text/plain;charset=utf-8";
  const content = String(message.content || "");
  const url = `data:${mime},${encodeURIComponent(content)}`;

  chrome.downloads.download(
    {
      url,
      filename: `gunma-isesaki/${message.filename}`,
      saveAs: false
    },
    (downloadId) => {
      sendResponse({
        ok: !chrome.runtime.lastError,
        downloadId,
        error: chrome.runtime.lastError ? chrome.runtime.lastError.message : ""
      });
    }
  );

  return true;
});
