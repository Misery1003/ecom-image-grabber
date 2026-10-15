/* =========================================================
   hosts.js — 平台域名配置 + 纯函数工具
   ---------------------------------------------------------
   这个文件同时被两个环境加载：
     1. 内容脚本（页面内注入，见 manifest.json 的 content_scripts）
     2. Node 单元测试（见 tests/）
   因此必须做到「不依赖任何 DOM / chrome API」，并且挂到
   globalThis 上以便两处复用。
   ========================================================= */
(function (root) {
  'use strict';

  /**
   * 支持的电商平台。
   * key   : 平台标识
   * label : 展示名
   * hosts : 域名后缀（匹配 host 本身或其子域）
   */
  var PLATFORMS = [
    { key: 'taobao', label: '淘宝', hosts: ['taobao.com'] },
    { key: 'tmall', label: '天猫', hosts: ['tmall.com'] },
    { key: 'jd', label: '京东', hosts: ['jd.com'] },
    { key: 'pdd', label: '拼多多商家版', hosts: ['pinduoduo.com', 'yangkeduo.com'] }
  ];

  /** 全部域名后缀，供 matches 之外的运行时判断使用 */
  var ALL_HOSTS = PLATFORMS.reduce(function (acc, p) {
    return acc.concat(p.hosts);
  }, []);

  /**
   * 判断某个 host 是否属于支持的平台。
   * 规则：host 等于后缀，或以「.后缀」结尾（避免 evildomain-taobao.com 被误判）。
   * @param {string} host
   * @returns {{key:string,label:string}|null}
   */
  function matchPlatform(host) {
    if (!host) return null;
    var h = String(host).toLowerCase().replace(/\.$/, '');
    for (var i = 0; i < PLATFORMS.length; i++) {
      var hosts = PLATFORMS[i].hosts;
      for (var j = 0; j < hosts.length; j++) {
        var suffix = hosts[j];
        if (h === suffix || h.slice(-(suffix.length + 1)) === '.' + suffix) {
          return { key: PLATFORMS[i].key, label: PLATFORMS[i].label };
        }
      }
    }
    return null;
  }

  /**
   * 判断 URL 是否是「商品详情页」。
   * 各平台详情页路径特征不同；这里只做宽松判断，命中即可注入按钮。
   * 之所以不写死严格规则，是因为平台改版频繁，宁可有少数非详情页也显示按钮，
   * 也不要漏掉真正的详情页。
   */
  var DETAIL_PATTERNS = [
    /\/item\.htm/i,          // 淘宝 / 天猫
    /\/item\//i,
    /\/detail/i,
    /\/goods/i,
    /\/product/i,
    /[?&](id|itemId|goods_id|goodsId)=\d+/i
  ];

  function isDetailPage(url) {
    if (!url) return false;
    var pathAndQuery = String(url).replace(/^https?:\/\/[^/]+/i, '');
    for (var i = 0; i < DETAIL_PATTERNS.length; i++) {
      if (DETAIL_PATTERNS[i].test(pathAndQuery)) return true;
    }
    return false;
  }

  /* ---------------------------------------------------------
     图片 URL 处理
     --------------------------------------------------------- */

  /** 明显的非商品图特征（图标、logo、占位符、加载动画等） */
  var BAD_URL_RE = /(sprite|icon|logo|avatar|qrcode|placeholder|loading|spacer|blank\.|1x1|transparent|data:image\/gif)/i;

  /** 从 URL 里尽量解析出「宽x高」声明（淘宝 / 京东的 CDN 常带） */
  function parseSizeFromUrl(url) {
    var m = String(url).match(/[_.\-@](\d{2,5})x(\d{2,5})(?:[_.\-]|$)/i) ||
            String(url).match(/[?&](?:width|w)=(\d{2,5})[^&]*[?&]?(?:height|h)=(\d{2,5})/i);
    if (!m) return null;
    return { width: parseInt(m[1], 10), height: parseInt(m[2], 10) };
  }

  /** 补全相对路径为绝对 URL；非法或非 http(s) 协议返回空串 */
  function toAbsoluteUrl(src, baseUrl) {
    if (!src) return '';
    var s = String(src).trim();
    if (!s) return '';
    // 明确排除伪协议与非图片 data URI
    if (/^(javascript|mailto|tel|about):/i.test(s)) return '';
    if (/^data:/i.test(s)) return '';
    if (/^blob:/i.test(s)) return '';
    try {
      return new URL(s, baseUrl || 'https://example.com/').href;
    } catch (e) {
      return '';
    }
  }

  /**
   * 解析 srcset，挑出声明宽度最大的一张。
   * srcset 形如： "a.jpg 400w, b.jpg 800w" 或 "a.jpg 1x, b.jpg 2x"
   */
  function pickLargestFromSrcset(srcset) {
    if (!srcset) return '';
    var best = '';
    var bestScore = -1;
    var parts = String(srcset).split(',');
    for (var i = 0; i < parts.length; i++) {
      var seg = parts[i].trim();
      if (!seg) continue;
      var bits = seg.split(/\s+/);
      var url = bits[0];
      var score = 1;
      if (bits[1]) {
        var d = bits[1].match(/^([\d.]+)(w|x)$/i);
        if (d) score = parseFloat(d[1]) * (/x$/i.test(d[2]) ? 1000 : 1);
      }
      if (score > bestScore) { bestScore = score; best = url; }
    }
    return best;
  }

  /**
   * 判断一个候选图片是否值得保留。
   * @param {{url:string,width?:number,height?:number}} item
   * @param {{minSize?:number, allowFile?:boolean}} [opts]
   *        allowFile 仅供本地联调/单测使用：允许 file:// 图片通过协议检查。
   *        线上运行时保持 false，只接受 http/https。
   */
  function isUsableImage(item, opts) {
    var o = opts || {};
    var minSize = o.minSize || 100;
    if (!item || !item.url) return false;

    var protoOk = /^https?:/i.test(item.url) || (o.allowFile && /^file:/i.test(item.url));
    if (!protoOk) return false;
    if (BAD_URL_RE.test(item.url)) return false;

    var w = item.width || 0;
    var h = item.height || 0;

    // 已知尺寸时按尺寸过滤
    if (w && h) {
      if (w < minSize || h < minSize) return false;
      // 极端长条多为分割线或装饰
      var ratio = w / h;
      if (ratio > 8 || ratio < 1 / 8) return false;
      return true;
    }

    // 尺寸未知时，用 URL 里的尺寸声明兜底
    var declared = parseSizeFromUrl(item.url);
    if (declared) {
      if (declared.width < minSize || declared.height < minSize) return false;
      return true;
    }

    // 完全无信息：保留，交给加载阶段再判断（宁可多留，不少留）
    return true;
  }

  /**
   * 归一化 URL，用于去重比较。
   * 站点常给 SVG 加 #iefix 之类的片段（IE 兼容写法），
   * 这类 URL 指向的是同一张图，必须视为重复。
   */
  function normalizeForDedupe(url) {
    if (!url) return '';
    var s = String(url).trim();
    var hash = s.indexOf('#');
    if (hash !== -1) s = s.slice(0, hash);   // 去掉片段
    return s;
  }

  /** 去重（按归一化 URL，忽略 #片段 造成的差异） */
  function dedupeByUrl(list) {
    var seen = Object.create(null);
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var url = list[i] && list[i].url;
      if (!url) continue;
      var key = normalizeForDedupe(url);
      if (!key || seen[key]) continue;
      seen[key] = 1;
      out.push(list[i]);
    }
    return out;
  }

  /** 生成下载文件名：商品图_001.png */
  function buildFileName(index, prefix, ext) {
    var n = String(index + 1);
    while (n.length < 3) n = '0' + n;
    return (prefix || '商品图') + '_' + n + '.' + (ext || 'png');
  }

  var api = {
    PLATFORMS: PLATFORMS,
    ALL_HOSTS: ALL_HOSTS,
    matchPlatform: matchPlatform,
    isDetailPage: isDetailPage,
    toAbsoluteUrl: toAbsoluteUrl,
    pickLargestFromSrcset: pickLargestFromSrcset,
    parseSizeFromUrl: parseSizeFromUrl,
    isUsableImage: isUsableImage,
    dedupeByUrl: dedupeByUrl,
    normalizeForDedupe: normalizeForDedupe,
    buildFileName: buildFileName
  };

  // 内容脚本里挂到 window；Node 测试里挂到 globalThis
  root.IGHosts = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
