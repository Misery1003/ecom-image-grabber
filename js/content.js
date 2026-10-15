/* =========================================================
   content.js — 内容脚本（注入到电商详情页）
   ---------------------------------------------------------
   职责：
     1. 在页面右下角注入「获取图片」悬浮按钮
     2. 点击后调用 IGCollect 扫描页面图片
     3. 把图片列表交给 background，由它打开发展示页
   依赖：js/hosts.js（域名与工具）、js/collect.js（扫描逻辑）
   ========================================================= */
(function () {
  'use strict';

  var H = globalThis.IGHosts || {};
  var C = globalThis.IGCollect || {};

  var BTN_ID = 'igh-fab';
  var TOAST_ID = 'igh-toast';
  // 本地联调开关：在任意页面地址后加 ?igh-scan 即强制注入按钮
  var MANUAL = /[?&]igh-scan\b/.test(location.search);

  /* ================= 一、提示条 ================= */

  function toast(msg, ms) {
    var t = document.getElementById(TOAST_ID);
    if (!t) {
      t = document.createElement('div');
      t.id = TOAST_ID;
      t.className = 'igh-toast';
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.classList.add('igh-toast--show');
    clearTimeout(t._timer);
    t._timer = setTimeout(function () { t.classList.remove('igh-toast--show'); }, ms || 2400);
  }

  /* ================= 二、悬浮按钮 ================= */

  function setBusy(btn, busy, text) {
    btn.disabled = !!busy;
    btn.classList.toggle('igh-fab--busy', !!busy);
    var label = btn.querySelector('.igh-fab__text');
    if (label) label.textContent = text || (busy ? '提取中…' : '获取图片');
  }

  function handleGrab(btn) {
    setBusy(btn, true);

    // 先让按钮渲染出加载态，再执行同步扫描，避免"点了没反应"的错觉
    setTimeout(function () {
      var list;
      try {
        list = C.collectImages(document, location.href, { minSize: 100 });
      } catch (e) {
        setBusy(btn, false);
        toast('扫描失败：' + e.message);
        console.error('[图提取] 扫描异常', e);
        return;
      }

      if (!list.length) {
        setBusy(btn, false);
        toast('未找到符合条件的商品图片（已过滤图标与占位图）');
        return;
      }

      var platform = (H.matchPlatform && H.matchPlatform(location.hostname)) || {};
      try {
        chrome.runtime.sendMessage({
          type: 'IGH_IMAGES_FOUND',
          payload: {
            images: list,
            pageUrl: location.href,
            pageTitle: document.title,
            platform: platform.label || ''
          }
        }, function (resp) {
          setBusy(btn, false);
          if (chrome.runtime.lastError) {
            toast('无法打开展示页：' + chrome.runtime.lastError.message);
            return;
          }
          if (resp && resp.ok) {
            toast('已提取 ' + list.length + ' 张图片，正在打开展示页…');
          } else {
            toast('打开展示页失败');
          }
        });
      } catch (e) {
        // 扩展被重新加载后，旧页面里的 content script 会失去上下文
        setBusy(btn, false);
        toast('扩展上下文已失效，请刷新页面后重试');
      }
    }, 60);
  }

  function injectButton() {
    if (document.getElementById(BTN_ID) || !document.body) return;

    var btn = document.createElement('button');
    btn.id = BTN_ID;
    btn.type = 'button';
    btn.className = 'igh-fab';
    btn.title = '提取本页所有商品图片';
    btn.innerHTML =
      '<span class="igh-fab__icon" aria-hidden="true">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" ' +
        'stroke-linecap="round" stroke-linejoin="round">' +
          '<rect x="3" y="3" width="18" height="18" rx="4"/>' +
          '<circle cx="8.5" cy="8.5" r="1.6"/>' +
          '<path d="m21 15-5-5L5 21"/>' +
        '</svg>' +
      '</span>' +
      '<span class="igh-fab__text">获取图片</span>';

    btn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      handleGrab(btn);
    });

    document.body.appendChild(btn);
  }

  /* ================= 三、注入判定与生命周期 ================= */

  function shouldInject() {
    if (MANUAL) return true;
    var p = H.matchPlatform && H.matchPlatform(location.hostname);
    if (!p) return false;
    return H.isDetailPage ? H.isDetailPage(location.href) : true;
  }

  function boot() {
    if (!shouldInject()) return;
    injectButton();

    // 单页应用路由切换会换内容，定时守护按钮状态（很轻量，2s 一次）
    var guard = setInterval(function () {
      if (!document.body) return;
      var has = document.getElementById(BTN_ID);
      if (shouldInject() && !has) injectButton();
      if (!shouldInject() && has) has.remove();
    }, 2000);
    window.addEventListener('pagehide', function () { clearInterval(guard); }, { once: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }

  /* ================= 四、响应 background 的主动扫描 ================= */

  chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (msg && msg.type === 'IGH_SCAN_NOW') {
      try {
        sendResponse({ images: C.collectImages(document, location.href, { minSize: 100 }) });
      } catch (e) {
        sendResponse({ images: [], error: e.message });
      }
    }
    return true;
  });
})();
