/* =========================================================
   collect.js — 页面图片扫描纯逻辑
   ---------------------------------------------------------
   只做「给定一个 document，返回候选图片列表」这件事，
   不碰 chrome API、不碰按钮注入，因此可以在 Node 里用假 DOM 单测。

   被两个环境复用：
     · 内容脚本（页面内注入）
     · Node 单元测试（tests/collect.test.js）
   ========================================================= */
(function (root) {
  'use strict';

  var H = root.IGHosts || (typeof require === 'function' ? safeRequire() : null);

  function safeRequire() {
    try { return require('./hosts.js'); } catch (e) { return null; }
  }

  /** 懒加载图片可能挂在很多不同属性上，统一在这里列举 */
  var LAZY_ATTRS = [
    'data-src', 'data-lazy-src', 'data-original', 'data-ks-lazyload',
    'data-image', 'data-img', 'data-url', 'data-actualsrc',
    'lazyload', 'data-lazyload', 'data-echo'
  ];

  function pickAttr(el, attrs) {
    for (var i = 0; i < attrs.length; i++) {
      var v = el.getAttribute(attrs[i]);
      if (v) return v;
    }
    return '';
  }

  /** 从 CSS background-image 文本中取出 url(...) */
  function extractBackgroundUrl(styleText) {
    if (!styleText) return '';
    var m = String(styleText).match(/url\((['"]?)([^'")]+)\1\)/i);
    return m ? m[2] : '';
  }

  function toAbs(url, base) {
    if (!url) return '';
    if (H && H.toAbsoluteUrl) return H.toAbsoluteUrl(url, base);
    try { return new URL(url, base).href; } catch (e) { return ''; }
  }

  /**
   * 扫描文档，返回候选图片（未过滤、未去重）
   * @param {Document} doc
   * @param {string} baseUrl
   * @returns {Array<{url:string,width:number,height:number,source:string}>}
   */
  function scanImages(doc, baseUrl) {
    var base = baseUrl || (doc.location && doc.location.href) || '';
    var out = [];

    function push(rawUrl, width, height, source) {
      var abs = toAbs(rawUrl, base);
      if (!abs) return;
      out.push({ url: abs, width: width || 0, height: height || 0, source: source || 'img' });
    }

    /* --- 1. <img> --- */
    var imgs = doc.querySelectorAll('img');
    for (var i = 0; i < imgs.length; i++) {
      var img = imgs[i];
      var w = img.naturalWidth || img.width || parseInt(img.getAttribute('width'), 10) || 0;
      var h = img.naturalHeight || img.height || parseInt(img.getAttribute('height'), 10) || 0;

      // srcset 通常能拿到更清晰的一张
      var srcset = img.getAttribute('srcset') || img.getAttribute('data-srcset');
      var best = srcset && H && H.pickLargestFromSrcset ? H.pickLargestFromSrcset(srcset) : '';

      var src = best || img.getAttribute('src') || pickAttr(img, LAZY_ATTRS);
      var bg = extractBackgroundUrl(img.getAttribute('style') || '');
      if (!src && bg) src = bg;

      if (src) push(src, w, h, best ? 'srcset' : 'img');
      // 同一张图上挂的懒加载备选地址也收集（主图切换、多图列表常见）
      var extra = pickAttr(img, LAZY_ATTRS);
      if (extra && extra !== src) push(extra, w, h, 'lazy');
    }

    /* --- 2. 普通元素的背景图 --- */
    var all = doc.querySelectorAll('*');
    for (var j = 0; j < all.length; j++) {
      var el = all[j];
      if (el.tagName === 'IMG') continue;
      var bgUrl = extractBackgroundUrl(el.getAttribute('style') || '');
      if (bgUrl) push(bgUrl, 0, 0, 'background');
    }

    /* --- 3. <source srcset> --- */
    var sources = doc.querySelectorAll('source[srcset], source[data-srcset]');
    for (var k = 0; k < sources.length; k++) {
      var ss = sources[k].getAttribute('srcset') || sources[k].getAttribute('data-srcset');
      var pick = ss && H && H.pickLargestFromSrcset ? H.pickLargestFromSrcset(ss) : '';
      if (pick) push(pick, 0, 0, 'source');
    }

    return out;
  }

  /**
   * 扫描 + 过滤 + 去重，得到最终要展示的图片列表
   * @param {Document} doc
   * @param {string} baseUrl
   * @param {{minSize?:number}} [opts]
   */
  function collectImages(doc, baseUrl, opts) {
    var raw = scanImages(doc, baseUrl);
    var usable = raw.filter(function (item) {
      return H && H.isUsableImage ? H.isUsableImage(item, opts) : true;
    });
    return H && H.dedupeByUrl ? H.dedupeByUrl(usable) : usable;
  }

  var api = {
    LAZY_ATTRS: LAZY_ATTRS,
    scanImages: scanImages,
    collectImages: collectImages,
    extractBackgroundUrl: extractBackgroundUrl,
    pickAttr: pickAttr
  };

  root.IGCollect = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
