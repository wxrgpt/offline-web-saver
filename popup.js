document.addEventListener('DOMContentLoaded', function() {
  // DOM元素
  const downloadBtn = document.getElementById('download-btn');
  const cssCheckbox = document.getElementById('css-checkbox');
  const jsCheckbox = document.getElementById('js-checkbox');
  const imagesCheckbox = document.getElementById('images-checkbox');
  const fontsCheckbox = document.getElementById('fonts-checkbox');
  const progressContainer = document.getElementById('progress-container');
  const progressBar = document.getElementById('progress-bar');
  const progressText = document.getElementById('progress-text');
  const statusMessage = document.getElementById('status-message');
  
  // 下载按钮点击事件
  downloadBtn.addEventListener('click', function() {
    // 收集选项
    const options = {
      downloadCSS: cssCheckbox.checked,
      downloadJS: jsCheckbox.checked,
      downloadImages: imagesCheckbox.checked,
      downloadFonts: fontsCheckbox.checked
    };
    
    // 显示进度条
    progressContainer.classList.remove('hidden');
    progressBar.style.width = '0%';
    progressText.textContent = '0%';
    statusMessage.textContent = '';
    statusMessage.className = '';
    
    // 禁用下载按钮
    downloadBtn.disabled = true;
    
    // 向当前标签页注入脚本
    chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
      chrome.tabs.sendMessage(
        tabs[0].id, 
        {action: 'startDownload', options: options},
        function(response) {
          if (chrome.runtime.lastError) {
            showError('无法与页面通信，请刷新页面后重试。');
            return;
          }
          
          if (!response || response.error) {
            showError(response ? response.error : '下载过程中发生错误。');
            return;
          }
          
          // 初始化下载过程
          console.log('开始下载流程');
        }
      );
    });
  });
  
  // 监听来自content script的消息
  chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
    if (request.action === 'updateProgress') {
      // 更新进度条
      const percent = Math.round(request.progress * 100);
      progressBar.style.width = `${percent}%`;
      progressText.textContent = `${percent}%`;
      
      if (request.status) {
        statusMessage.textContent = request.status;
      }
      
      sendResponse({received: true});
    }
    else if (request.action === 'downloadComplete') {
      // 下载完成
      progressBar.style.width = '100%';
      progressText.textContent = '100%';
      statusMessage.textContent = '下载完成！';
      statusMessage.className = 'success';
      
      // 重新启用下载按钮
      downloadBtn.disabled = false;
      
      sendResponse({received: true});
    }
    else if (request.action === 'downloadError') {
      // 下载错误
      showError(request.error || '下载过程中发生错误');
      sendResponse({received: true});
    }
    
    // 返回true表示将异步发送响应
    return true;
  });
  
  function showError(message) {
    progressContainer.classList.add('hidden');
    statusMessage.textContent = message;
    statusMessage.className = 'error';
    downloadBtn.disabled = false;
  }
});