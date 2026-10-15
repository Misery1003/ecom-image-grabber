/* =========================================================
   background.js — Service Worker
   ---------------------------------------------------------
   职责：
     1. 接收 content script 提取到的图片列表，落到 storage
     2. 打开（或复用）展示页 gallery.html
     3. 点击扩展图标时，主动让页面扫描一次
   注意：MV3 的 service worker 会随时休眠，所以所有状态都放
        chrome.storage，不放内存变量。
   ========================================================= */
'use strict';

var STATE_KEY = 'igh:lastExtract';
var GALLERY_URL = 'gallery.html';

/**
 * 打开展示页；若已存在就聚焦到它，避免开一堆标签页
 */
function openGallery() {
  var full = chrome.runtime.getURL(GALLERY_URL);
  if (!chrome.tabs || !chrome.tabs.query) {
    return chrome.tabs.create({ url: full });
  }
  return chrome.tabs.query({ url: full + '*' }, function (tabs) {
    if (chrome.runtime.lastError) {
      chrome.tabs.create({ url: full });
      return;
    }
    if (tabs && tabs.length) {
      chrome.tabs.update(tabs[0].id, { active: true }, function () {
        if (chrome.windows && tabs[0].windowId != null) {
          chrome.windows.update(tabs[0].windowId, { focused: true });
        }
      });
    } else {
      chrome.tabs.create({ url: full });
    }
  });
}

/**
 * 保存提取结果
 * @param {{images:Array, pageUrl:string, pageTitle:string, platform:string}} payload
 */
function saveImages(payload) {
  return new Promise(function (resolve) {
    var record = {
      images: payload.images || [],
      pageUrl: payload.pageUrl || '',
      pageTitle: payload.pageTitle || '',
      platform: payload.platform || '',
      at: Date.now()
    };
    chrome.storage.local.set({ 'igh:lastExtract': record }, function () {
      resolve(record);
    });
  });
}

/* ---------------- 消息处理 ---------------- */

chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  if (!msg || !msg.type) return;

  if (msg.type === 'IGH_IMAGES_FOUND') {
    saveImages(msg.payload || {}).then(function () {
      openGallery();
      sendResponse({ ok: true });
    });
    return true; // 异步响应
  }

  if (msg.type === 'IGH_GET_STATE') {
    chrome.storage.local.get([STATE_KEY], function (obj) {
      sendResponse({ state: (obj && obj[STATE_KEY]) || null });
    });
    return true;
  }

  if (msg.type === 'IGH_STAT') {
    // 供调试：查看当前存了多少张
    chrome.storage.local.get([STATE_KEY], function (obj) {
      var s = obj && obj[STATE_KEY];
      sendResponse({ count: s && s.images ? s.images.length : 0, at: s && s.at });
    });
    return true;
  }
});

/* ---------------- 点击扩展图标 ---------------- */

chrome.action.onClicked.addListener(function (tab) {
  if (!tab || !tab.id) { openGallery(); return; }

  // 先试直接让已在页面里的内容脚本扫描
  chrome.tabs.sendMessage(tab.id, { type: 'IGH_SCAN_NOW' }, function (resp) {
    if (!chrome.runtime.lastError && resp && resp.images && resp.images.length) {
      saveImages({
        images: resp.images,
        pageUrl: tab.url,
        pageTitle: tab.title,
        platform: ''
      }).then(openGallery);
      return;
    }

    // 内容脚本不在（例如非详情页或未注入），主动注入一次再扫描
    if (!chrome.scripting) { openGallery(); return; }
    chrome.scripting.executeScript(
      { target: { tabId: tab.id }, files: ['js/hosts.js', 'js/collect.js', 'js/content.js'] },
      function () {
        if (chrome.runtime.lastError) {
          // 注入失败（如 chrome:// 页面）就直接打开已有结果
          openGallery();
          return;
        }
        chrome.tabs.sendMessage(tab.id, { type: 'IGH_SCAN_NOW' }, function (r2) {
          var imgs = (!chrome.runtime.lastError && r2 && r2.images) || [];
          saveImages({
            images: imgs,
            pageUrl: tab.url,
            pageTitle: tab.title,
            platform: ''
          }).then(openGallery);
        });
      }
    );
  });
});

/* ---------------- 安装提示 ---------------- */

chrome.runtime.onInstalled.addListener(function (details) {
  if (details.reason === 'install') {
    chrome.tabs.create({ url: chrome.runtime.getURL(GALLERY_URL) });
  }
});
