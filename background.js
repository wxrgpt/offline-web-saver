// 在background.js文件顶部添加
chrome.downloads.onCreated.addListener(function(downloadItem) {
  if (downloadItem.byExtensionId === chrome.runtime.id) {
    // 自动确认由我们的扩展创建的下载
    chrome.downloads.acceptDanger(downloadItem.id, function() {
      console.log('自动确认下载:', downloadItem.filename);
    });
  }
});

// 监听来自content script的消息
chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
  if (request.action === 'downloadFile') {
    chrome.downloads.download({
      url: request.url,
      filename: request.filename,
      saveAs: request.saveAs || false,
      conflictAction: 'uniquify'
    }, function(downloadId) {
      if (chrome.runtime.lastError) {
        console.error('下载出错:', chrome.runtime.lastError);
        sendResponse({error: chrome.runtime.lastError.message});
      } else {
        sendResponse({success: true, downloadId: downloadId});
      }
    });

    // 返回true表示将异步发送响应
    return true;
  }
  else if (request.action === 'createDirectories') {
    // 这里不需要实际创建目录，因为downloads API会自动创建目录
    // 只需要确认收到消息
    sendResponse({success: true});
    return true;
  }
});