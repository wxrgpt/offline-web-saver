// 监听来自popup的消息
chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
  if (request.action === 'startDownload') {
    console.log('收到下载请求', request.options);
    startDownloadProcess(request.options)
      .then(() => {
        sendResponse({success: true});
      })
      .catch(error => {
        console.error('下载过程出错:', error);
        sendResponse({error: error.message || '下载过程中发生错误'});
      });

    // 返回true表示将异步发送响应
    return true;
  }
});

// 完整的下载流程，使用浏览器API
async function startDownloadProcess(options) {
  try {
    // 获取当前页面URL和标题
    const pageUrl = window.location.href;
    const pageTitle = document.title || 'webpage';
    const folderName = sanitizeFilename(pageTitle);

    // 创建资源收集器
    const resources = {
      html: null,
      css: [],
      js: [],
      images: [],
      fonts: []
    };

    // 资源计数器 - 用于显示进度
    let totalResources = 1; // 初始为1 (HTML文件)
    let loadedResources = 0;

    // 更新进度函数
    function updateProgress(status) {
      const progress = totalResources > 0 ? loadedResources / totalResources : 0;
      chrome.runtime.sendMessage({
        action: 'updateProgress',
        progress: progress,
        status: status
      });
    }

    updateProgress('正在分析页面结构...');

    // 1. 获取并处理HTML
    console.log('处理HTML内容');
    let htmlContent = document.documentElement.outerHTML;

    // 确保HTML有正确的编码声明
    if (!htmlContent.includes('<meta charset')) {
      htmlContent = htmlContent.replace('<head>', '<head>\n  <meta charset="UTF-8">');
    }

    // 资源映射表：原始URL -> 本地路径
    const resourceMap = new Map();

    // 2. 收集CSS资源
    if (options.downloadCSS) {
      updateProgress('正在收集CSS资源...');
      console.log('收集CSS资源');
      const styleLinks = document.querySelectorAll('link[rel="stylesheet"]');
      styleLinks.forEach(link => {
        if (link.href) {
          resources.css.push({
            url: link.href,
            originalUrl: link.href
          });
          totalResources++;
        }
      });
    }

    // 3. 收集JS资源
    if (options.downloadJS) {
      updateProgress('正在收集JavaScript资源...');
      console.log('收集JS资源');
      const scripts = document.querySelectorAll('script[src]');
      scripts.forEach(script => {
        if (script.src) {
          resources.js.push({
            url: script.src,
            originalUrl: script.src
          });
          totalResources++;
        }
      });
    }

    // 4. 收集图片资源
    if (options.downloadImages) {
      updateProgress('正在收集图片资源...');
      console.log('收集图片资源');
      const images = document.querySelectorAll('img[src]');
      images.forEach(img => {
        if (img.src && !img.src.startsWith('data:')) {
          resources.images.push({
            url: img.src,
            originalUrl: img.src
          });
          totalResources++;
        }
      });
    }

    // 5. 收集字体资源 (通过CSS @font-face 规则)
    if (options.downloadFonts) {
      updateProgress('正在收集字体资源...');
      console.log('收集字体资源');
      // 尝试从样式表中找到字体
      try {
        for (let i = 0; i < document.styleSheets.length; i++) {
          try {
            const styleSheet = document.styleSheets[i];
            const rules = styleSheet.cssRules || styleSheet.rules;
            if (!rules) continue;

            for (let j = 0; j < rules.length; j++) {
              const rule = rules[j];
              // 检查是否是@font-face规则
              if (rule.type === CSSRule.FONT_FACE_RULE) {
                const fontSrc = rule.style.getPropertyValue('src');
                if (fontSrc) {
                  // 提取URL
                  const urlMatches = fontSrc.match(/url\(['"](.*?)['"]\)/g);
                  if (urlMatches) {
                    urlMatches.forEach(urlMatch => {
                      const fontUrl = urlMatch.replace(/url\(['"](.+?)['"]\)/, '$1');
                      if (fontUrl && !fontUrl.startsWith('data:')) {
                        // 构建完整URL
                        const fullFontUrl = new URL(fontUrl, styleSheet.href || window.location.href).href;
                        resources.fonts.push({
                          url: fullFontUrl,
                          originalUrl: fontUrl
                        });
                        totalResources++;
                      }
                    });
                  }
                }
              }
            }
          } catch (e) {
            console.warn('无法访问样式表规则', e);
          }
        }
      } catch (e) {
        console.warn('字体收集出错', e);
      }
    }

    // 创建一个清单HTML，列出所有资源
    let manifestHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>${folderName} - 下载资源清单</title>
  <style>
    body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
    h1 { color: #333; }
    .resources { margin: 20px 0; }
    .resource-section { margin-bottom: 30px; }
    .resource-item { padding: 8px; border-bottom: 1px solid #eee; display: flex; }
    .resource-item:hover { background-color: #f8f8f8; }
    .resource-type { min-width: 120px; font-weight: bold; }
    .resource-link { color: #0066cc; text-decoration: none; flex-grow: 1; }
    .resource-link:hover { text-decoration: underline; }
    .resource-size { min-width: 80px; text-align: right; color: #666; }
    .download-btn { background-color: #4285f4; color: white; border: none; padding: 10px 15px; 
                   border-radius: 4px; cursor: pointer; margin-top: 20px; }
    .note { color: #666; font-style: italic; margin-top: 20px; }
  </style>
</head>
<body>
  <h1>${folderName}</h1>
  <p>网页资源已下载完成，保存在以下目录结构中：</p>
  
  <div class="resources">
    <h2>资源列表</h2>
    
    <div class="resource-section">
      <h3>主HTML文件</h3>
      <div class="resource-item">
        <span class="resource-type">HTML</span>
        <a href="index.html" class="resource-link">index.html</a>
      </div>
    </div>
`;

    // 6. 开始下载资源
    // 6.1 创建下载任务队列 - 这样我们可以控制并发下载量
    const downloadQueue = [];

    // 6.2 将HTML添加到下载队列
    downloadQueue.push(async () => {
      updateProgress('正在处理HTML...');

      // 修改HTML中的资源路径
      const modifiedHtml = rewriteHtml(htmlContent, resourceMap);

      // 创建HTML blob
      const htmlBlob = new Blob([modifiedHtml], { type: 'text/html;charset=UTF-8' });

      // 下载HTML文件
      await downloadResource(htmlBlob, folderName + '/index.html');

      loadedResources++;
      updateProgress('HTML文件已处理');
    });

    // 6.3 处理CSS资源
    if (resources.css.length > 0) {
      manifestHtml += `
    <div class="resource-section">
      <h3>CSS样式表 (${resources.css.length}个)</h3>
`;

      for (let i = 0; i < resources.css.length; i++) {
        const cssResource = resources.css[i];
        const fileName = getFileName(cssResource.url, 'style_' + i, '.css');
        const localPath = 'css/' + fileName;

        // 更新资源映射
        resourceMap.set(cssResource.originalUrl, localPath);

        manifestHtml += `
      <div class="resource-item">
        <span class="resource-type">CSS</span>
        <a href="${localPath}" class="resource-link">${localPath}</a>
      </div>`;

        // 添加到下载队列
        downloadQueue.push(async () => {
          try {
            updateProgress(`正在下载CSS: ${fileName}`);

            // 下载CSS内容
            const response = await fetch(cssResource.url);
            let cssText = await response.text();

            // 处理CSS中的URL引用
            cssText = rewriteCssUrls(cssText, cssResource.url, resourceMap);

            // 下载CSS文件
            const cssBlob = new Blob([cssText], { type: 'text/css;charset=UTF-8' });
            await downloadResource(cssBlob, `${folderName}/${localPath}`);

            loadedResources++;
            updateProgress();
          } catch (error) {
            console.warn(`无法下载CSS: ${cssResource.url}`, error);
            loadedResources++;
            updateProgress();
          }
        });
      }

      manifestHtml += `
    </div>`;
    }

    // 6.4 处理JS资源
    if (resources.js.length > 0) {
      manifestHtml += `
    <div class="resource-section">
      <h3>JavaScript文件 (${resources.js.length}个)</h3>
`;

      for (let i = 0; i < resources.js.length; i++) {
        const jsResource = resources.js[i];
        const fileName = getFileName(jsResource.url, 'script_' + i, '.js');
        const localPath = 'js/' + fileName;

        // 更新资源映射
        resourceMap.set(jsResource.originalUrl, localPath);

        manifestHtml += `
      <div class="resource-item">
        <span class="resource-type">JavaScript</span>
        <a href="${localPath}" class="resource-link">${localPath}</a>
      </div>`;

        // 添加到下载队列
        downloadQueue.push(async () => {
          try {
            updateProgress(`正在下载JS: ${fileName}`);

            // 下载JS内容
            const response = await fetch(jsResource.url);
            const jsText = await response.text();

            // 下载JS文件
            const jsBlob = new Blob([jsText], { type: 'text/javascript;charset=UTF-8' });
            await downloadResource(jsBlob, `${folderName}/${localPath}`);

            loadedResources++;
            updateProgress();
          } catch (error) {
            console.warn(`无法下载JS: ${jsResource.url}`, error);
            loadedResources++;
            updateProgress();
          }
        });
      }

      manifestHtml += `
    </div>`;
    }

    // 6.5 处理图片资源
    if (resources.images.length > 0) {
      manifestHtml += `
    <div class="resource-section">
      <h3>图片资源 (${resources.images.length}个)</h3>
`;

      for (let i = 0; i < resources.images.length; i++) {
        const imgResource = resources.images[i];
        const ext = getExtensionFromUrl(imgResource.url);
        const fileName = getFileName(imgResource.url, 'image_' + i, ext);
        const localPath = 'images/' + fileName;

        // 更新资源映射
        resourceMap.set(imgResource.originalUrl, localPath);

        manifestHtml += `
      <div class="resource-item">
        <span class="resource-type">图片</span>
        <a href="${localPath}" class="resource-link">${localPath}</a>
      </div>`;

        // 添加到下载队列
        downloadQueue.push(async () => {
          try {
            updateProgress(`正在下载图片: ${fileName}`);

            // 下载图片内容
            const response = await fetch(imgResource.url);
            const imgBlob = await response.blob();

            // 下载图片文件
            await downloadResource(imgBlob, `${folderName}/${localPath}`);

            loadedResources++;
            updateProgress();
          } catch (error) {
            console.warn(`无法下载图片: ${imgResource.url}`, error);
            loadedResources++;
            updateProgress();
          }
        });
      }

      manifestHtml += `
    </div>`;
    }

    // 6.6 处理字体资源
    if (resources.fonts.length > 0) {
      manifestHtml += `
    <div class="resource-section">
      <h3>字体文件 (${resources.fonts.length}个)</h3>
`;

      for (let i = 0; i < resources.fonts.length; i++) {
        const fontResource = resources.fonts[i];
        const ext = getExtensionFromUrl(fontResource.url);
        const fileName = getFileName(fontResource.url, 'font_' + i, ext);
        const localPath = 'fonts/' + fileName;

        // 更新资源映射
        resourceMap.set(fontResource.originalUrl, localPath);

        manifestHtml += `
      <div class="resource-item">
        <span class="resource-type">字体</span>
        <a href="${localPath}" class="resource-link">${localPath}</a>
      </div>`;

        // 添加到下载队列
        downloadQueue.push(async () => {
          try {
            updateProgress(`正在下载字体: ${fileName}`);

            // 下载字体内容
            const response = await fetch(fontResource.url);
            const fontBlob = await response.blob();

            // 下载字体文件
            await downloadResource(fontBlob, `${folderName}/${localPath}`);

            loadedResources++;
            updateProgress();
          } catch (error) {
            console.warn(`无法下载字体: ${fontResource.url}`, error);
            loadedResources++;
            updateProgress();
          }
        });
      }

      manifestHtml += `
    </div>`;
    }

    // 完成清单HTML
    manifestHtml += `
  </div>
  
  <p class="note">提示：请将所有文件保持在相同的文件夹结构中，以确保网页能够正确显示。您可以通过打开"index.html"文件来查看下载的网页。</p>
</body>
</html>`;

    // 添加清单文件到下载队列
    downloadQueue.push(async () => {
      const manifestBlob = new Blob([manifestHtml], { type: 'text/html;charset=UTF-8' });
      await downloadResource(manifestBlob, `${folderName}/README.html`);
    });

    // 7. 执行下载队列 - 先下载HTML，然后是其他资源
    updateProgress('正在准备下载...');

    // 一次性处理所有下载任务
    await downloadQueue[0](); // 先下载HTML

    // 创建目录结构信息并发送给background.js以创建文件夹
    const directories = [
      `${folderName}/css`,
      `${folderName}/js`,
      `${folderName}/images`,
      `${folderName}/fonts`
    ];

    chrome.runtime.sendMessage({
      action: 'createDirectories',
      directories: directories
    });

    // 下载其他资源（同时处理5个资源）
    const concurrentDownloads = 5;
    const remainingTasks = downloadQueue.slice(1);

    // 分批处理下载任务
    while (remainingTasks.length > 0) {
      const batch = remainingTasks.splice(0, concurrentDownloads);
      await Promise.all(batch.map(task => task()));
    }

    // 8. 完成下载
    updateProgress('所有资源下载完成！');
    chrome.runtime.sendMessage({ action: 'downloadComplete' });

    return true;
  } catch (error) {
    console.error('下载过程中出错:', error);
    chrome.runtime.sendMessage({
      action: 'downloadError',
      error: error.message || '下载过程中发生错误'
    });
    throw error;
  }
}

// 重写HTML中的资源路径
function rewriteHtml(html, resourceMap) {
  // 创建临时的DOM解析器
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');

  // 修改base标签或添加一个新的base标签
  let baseTag = doc.querySelector('base');
  if (baseTag) {
    baseTag.setAttribute('href', './');
  } else {
    const head = doc.querySelector('head');
    if (head) {
      baseTag = doc.createElement('base');
      baseTag.setAttribute('href', './');
      head.insertBefore(baseTag, head.firstChild);
    }
  }

  // 处理CSS链接
  doc.querySelectorAll('link[rel="stylesheet"]').forEach(link => {
    if (link.href && resourceMap.has(link.href)) {
      link.setAttribute('href', resourceMap.get(link.href));
    }
  });

  // 处理脚本
  doc.querySelectorAll('script[src]').forEach(script => {
    if (script.src && resourceMap.has(script.src)) {
      script.setAttribute('src', resourceMap.get(script.src));
    }
  });

  // 处理图片
  doc.querySelectorAll('img[src]').forEach(img => {
    if (img.src && resourceMap.has(img.src)) {
      img.setAttribute('src', resourceMap.get(img.src));
    }
  });

  // 处理a标签的相对链接
  doc.querySelectorAll('a[href]').forEach(a => {
    const href = a.getAttribute('href');
    if (href && !href.startsWith('#') && !href.includes('://')) {
      // 如果是相对链接，加上./前缀
      if (href.startsWith('/')) {
        a.setAttribute('href', '.' + href);
      }
    }
  });

  // 返回修改后的HTML
  return '<!DOCTYPE html>\n' + doc.documentElement.outerHTML;
}

// 重写CSS中的URL引用
function rewriteCssUrls(cssText, cssUrl, resourceMap) {
  // 处理url()引用
  return cssText.replace(/url\(['"]?([^'"\)]+)['"]?\)/g, (match, url) => {
    // 跳过数据URL
    if (url.startsWith('data:')) return match;

    // 构建完整URL
    const fullUrl = new URL(url, cssUrl).href;

    // 如果资源映射中有这个URL，替换为本地路径
    if (resourceMap.has(fullUrl)) {
      return `url('../${resourceMap.get(fullUrl)}')`;
    }

    // 否则保持原样
    return match;
  });
}

// 通过background.js下载资源
function downloadResource(blob, filename) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);

    chrome.runtime.sendMessage({
      action: 'downloadFile',
      url: url,
      filename: filename,
      saveAs: false // 不显示保存对话框
    }, response => {
      URL.revokeObjectURL(url);

      if (response && response.success) {
        resolve(response.downloadId);
      } else {
        reject(new Error(response ? response.error : '下载失败'));
      }
    });
  });
}

// 辅助函数：从URL获取文件名
function getFileName(url, prefix, defaultExt) {
  try {
    // 获取URL的路径部分
    let path = new URL(url).pathname;
    // 提取最后一部分作为文件名
    let fileName = path.split('/').pop();

    // 如果文件名为空或无效，使用前缀+随机数
    if (!fileName || fileName === '' || fileName.indexOf('.') === -1) {
      const randomId = Math.floor(Math.random() * 10000);
      fileName = `${prefix}_${randomId}${defaultExt}`;
    }

    // 移除查询参数（如有）
    fileName = fileName.split('?')[0].split('#')[0];

    // 清理文件名
    return sanitizeFilename(fileName);
  } catch (e) {
    // 如果URL解析失败，使用前缀+随机数
    const randomId = Math.floor(Math.random() * 10000);
    return `${prefix}_${randomId}${defaultExt}`;
  }
}

// 辅助函数：从URL获取扩展名
function getExtensionFromUrl(url) {
  try {
    const pathname = new URL(url).pathname;
    const fileName = pathname.split('/').pop();
    const parts = fileName.split('.');

    if (parts.length > 1) {
      const ext = '.' + parts.pop().split('?')[0].split('#')[0];
      // 返回标准化的扩展名
      if (/(\.png|\.jpe?g|\.gif|\.svg|\.webp|\.bmp|\.ico)$/i.test(ext)) {
        return ext.toLowerCase();
      }
      // 字体文件
      if (/(\.woff2?|\.ttf|\.eot|\.otf)$/i.test(ext)) {
        return ext.toLowerCase();
      }
      return ext.toLowerCase();
    }

    // 根据内容类型猜测扩展名
    if (url.includes('font')) return '.woff';
    if (url.includes('image')) return '.png';
    return '.bin'; // 默认扩展名
  } catch (e) {
    return '.bin'; // 如果无法解析，返回一个通用扩展名
  }
}

// 辅助函数：清理文件名
function sanitizeFilename(name) {
  // 删除不允许的字符
  return name
    .replace(/[/\\?%*:|"<>]/g, '_') // 替换非法字符
    .replace(/\s+/g, '_')           // 替换空格
    .replace(/^\.+/g, '')           // 删除开头的点
    .substring(0, 100);             // 限制长度
}