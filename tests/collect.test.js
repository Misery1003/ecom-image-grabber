/* =========================================================
   collect.test.js — 用 Node 单测插件核心逻辑
   ---------------------------------------------------------
   做法：手写一个极简 DOM 假实现（只实现插件真正用到的几个接口），
        并直接解析 demo/product-page.html 里的真实标签来构造假 DOM。
        这样测的是「插件逻辑」，而不是「我会不会写 mock」。

   运行： node tests/collect.test.js
   ========================================================= */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');

/* ---------------- 载入被测模块 ---------------- */

const sandbox = { console, setTimeout, clearTimeout, URL, Set, Promise, require };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

for (const f of ['js/hosts.js', 'js/collect.js']) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sandbox, { filename: f });
}

const H = sandbox.IGHosts;
const C = sandbox.IGCollect;

/* ---------------- 极简 DOM 假实现 ---------------- */

function parseAttrs(tag) {
  const attrs = {};
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let m;
  while ((m = re.exec(tag)) !== null) {
    attrs[m[1].toLowerCase()] = m[3] !== undefined ? m[3] : m[4];
  }
  return attrs;
}

function makeEl(tagName, attrs) {
  return {
    tagName: tagName.toUpperCase(),
    getAttribute: (n) => (n in attrs ? attrs[n] : null),
    get naturalWidth() { return parseInt(attrs.naturalwidth || '0', 10) || 0; },
    get naturalHeight() { return parseInt(attrs.naturalheight || '0', 10) || 0; },
    get width() { return parseInt(attrs.width || '0', 10) || 0; },
    get height() { return parseInt(attrs.height || '0', 10) || 0; }
  };
}

/** 从真实 HTML 解析出假 DOM —— 保证 fixture 与 demo 页面一致 */
function buildFakeDom(html) {
  const imgs = [];
  const others = [];

  const imgRe = /<img\b[^>]*>/gi;
  let m;
  while ((m = imgRe.exec(html)) !== null) {
    imgs.push(makeEl('img', parseAttrs(m[0])));
  }

  // 带 background-image 的非 img 元素
  const elRe = /<(div|span|section|a)\b([^>]*style\s*=\s*"[^"]*background-image[^"]*"[^>]*)>/gi;
  while ((m = elRe.exec(html)) !== null) {
    others.push(makeEl(m[1], parseAttrs('<' + m[1] + ' ' + m[2] + '>')));
  }

  return {
    location: { href: 'file:///F:/ecom-image-grabber/demo/product-page.html' },
    querySelectorAll(sel) {
      if (sel === 'img') return imgs;
      if (sel === '*') return imgs.concat(others);
      if (/^source\[/.test(sel)) return [];
      return [];
    }
  };
}

const DEMO = path.join(ROOT, 'demo', 'product-page.html');
const html = fs.readFileSync(DEMO, 'utf8');
const doc = buildFakeDom(html);
const BASE = 'file:///F:/ecom-image-grabber/demo/product-page.html';
const OPTS = { minSize: 100, allowFile: true }; // demo 以 file:// 打开

/* ---------------- 测试框架 ---------------- */

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ FAIL: ' + name + (extra ? '  →  ' + extra : '')); }
}
function section(t) { console.log('\n' + t); }

/* ---------------- 1. 域名与详情页判定 ---------------- */

section('1. 平台域名匹配');
check('item.taobao.com → 淘宝', (H.matchPlatform('item.taobao.com') || {}).key === 'taobao');
check('detail.tmall.com → 天猫', (H.matchPlatform('detail.tmall.com') || {}).key === 'tmall');
check('item.jd.com → 京东', (H.matchPlatform('item.jd.com') || {}).key === 'jd');
check('mobile.yangkeduo.com → 拼多多', (H.matchPlatform('mobile.yangkeduo.com') || {}).key === 'pdd');
check('大小写不敏感 (ITEM.TAOBAO.COM)', (H.matchPlatform('ITEM.TAOBAO.COM') || {}).key === 'taobao');
check('仿冒域名 evildomain-taobao.com 不应命中', H.matchPlatform('evildomain-taobao.com') === null,
  JSON.stringify(H.matchPlatform('evildomain-taobao.com')));
check('不相关域名 example.com 不命中', H.matchPlatform('example.com') === null);
check('空值返回 null', H.matchPlatform('') === null && H.matchPlatform(null) === null);

section('2. 商品详情页判定');
check('淘宝 /item.htm?id=123', H.isDetailPage('https://item.taobao.com/item.htm?id=123'));
check('天猫 /item/456', H.isDetailPage('https://detail.tmall.com/item/456'));
check('京东 /product/9988.html', H.isDetailPage('https://item.jd.com/product/9988.html'));
check('拼多多 goods_id 参数', H.isDetailPage('https://mobile.yangkeduo.com/goods.html?goods_id=556677'));
check('首页不应判定为详情页', !H.isDetailPage('https://www.taobao.com/'));
check('搜索页不应判定为详情页', !H.isDetailPage('https://s.taobao.com/search?q=shirt'));

/* ---------------- 3. 工具函数 ---------------- */

section('3. 工具函数');
check('toAbsoluteUrl 补全相对路径',
  H.toAbsoluteUrl('assets/a.svg', 'https://x.com/dir/p.html') === 'https://x.com/dir/assets/a.svg');
check('toAbsoluteUrl 拒绝 javascript: 伪协议', H.toAbsoluteUrl('javascript:alert(1)', 'https://x.com') === '');
check('toAbsoluteUrl 拒绝 data: URI', H.toAbsoluteUrl('data:image/png;base64,AAA', 'https://x.com') === '');
check('pickLargestFromSrcset 取最大宽度',
  H.pickLargestFromSrcset('a.svg 400w, b.svg 1600w, c.svg 900w') === 'b.svg');
check('pickLargestFromSrcset 处理 2x 描述符',
  H.pickLargestFromSrcset('a.svg 1x, b.svg 2x') === 'b.svg');
check('buildFileName 补零到 3 位', H.buildFileName(0) === '商品图_001.png' &&
  H.buildFileName(9, '商品图', 'png') === '商品图_010.png' &&
  H.buildFileName(123) === '商品图_124.png');
check('parseSizeFromUrl 解析 _800x800',
  JSON.stringify(H.parseSizeFromUrl('https://img.com/a_800x800.jpg')) === '{"width":800,"height":800}');

section('4. 图片可用性过滤（阈值 100）');
const cases = [
  ['800×800 商品图保留', { url: 'https://a.com/p.svg', width: 800, height: 800 }, true],
  ['80×80 LOGO 剔除', { url: 'https://a.com/p.svg', width: 80, height: 80 }, false],
  ['99×120 剔除（小于阈值）', { url: 'https://a.com/p.svg', width: 99, height: 120 }, false],
  ['1×1 剔除', { url: 'https://a.com/p.svg', width: 1, height: 1 }, false],
  ['100×100 保留（等于阈值）', { url: 'https://a.com/p.svg', width: 100, height: 100 }, true],
  ['文件名含 icon 剔除', { url: 'https://a.com/icon-cart.svg', width: 400, height: 400 }, false],
  ['文件名含 logo 剔除', { url: 'https://a.com/shop-logo.png', width: 400, height: 400 }, false],
  ['文件名含 placeholder 剔除', { url: 'https://a.com/placeholder.gif', width: 400, height: 400 }, false],
  ['极端长条 2000×100 剔除', { url: 'https://a.com/bar.png', width: 2000, height: 100 }, false],
  ['尺寸未知但 URL 声明过小 剔除', { url: 'https://a.com/pic_50x50.jpg', width: 0, height: 0 }, false],
  ['尺寸未知且无声明 保留', { url: 'https://a.com/pic.jpg', width: 0, height: 0 }, true],
  ['非 http 协议剔除', { url: 'ftp://a.com/p.png', width: 400, height: 400 }, false]
];
for (const [name, item, want] of cases) {
  check(name, H.isUsableImage(item, { minSize: 100 }) === want);
}

section('4b. file 协议默认被拒（安全默认值，仅联调放行）');
check('默认拒绝 file:// 图片',
  H.isUsableImage({ url: 'file:///a.png', width: 800, height: 800 }, { minSize: 100 }) === false);
check('显式 allowFile 后放行',
  H.isUsableImage({ url: 'file:///a.png', width: 800, height: 800 }, OPTS) === true);

/* ---------------- 5. 真实页面扫描 ---------------- */

section('5. 扫描 demo 商品页（真实标签）');
const raw = C.scanImages(doc, BASE);
check('扫描到候选图片（含重复）', raw.length > 0, 'raw=' + raw.length);

const got = C.collectImages(doc, BASE, OPTS);
const urls = got.map((x) => x.url);
// 去掉扩展名，只比较基名，这样 demo 图片换成 png/svg 都不影响断言
const fileOf = (u) => decodeURIComponent(u.split('/').pop()).replace(/\.[a-z0-9]+$/i, '');
const files = urls.map(fileOf);

console.log('  最终提取 ' + got.length + ' 张：');
got.forEach((x, i) => console.log(`    ${i + 1}. ${fileOf(x.url)}  [${x.source}]  ${x.width}×${x.height}`));

// demo 页面里 6 张商品图被多种写法反复引用（主图/缩略图/懒加载/背景/详情），
// 去重后应恰好剩 6 张
check('去重后提取到 6 张', got.length === 6, '实际 ' + got.length);

for (const f of ['product-1', 'product-2', 'product-3', 'product-4', 'product-5', 'product-6']) {
  check('包含 ' + f, files.includes(f));
}

section('6. 干扰项必须被过滤');
check('不含 logo', !files.includes('logo'));
check('不含 icon-cart', !files.includes('icon-cart'));
check('不含 spacer', !files.includes('spacer'));

section('7. 来源与去重');
check('srcset 取到最大的一张 product-5',
  got.some((x) => fileOf(x.url) === 'product-5' && x.source === 'srcset'));
check('懒加载 data-src 被识别（product-6）',
  got.some((x) => fileOf(x.url) === 'product-6' && x.source === 'lazy'));
// 背景图在原始扫描阶段被识别（去重后会保留先出现的 srcset 那条）
check('背景图在扫描阶段被识别为 background 来源',
  raw.some((x) => fileOf(x.url) === 'product-5' && x.source === 'background'));
check('product-5 只出现一次（srcset 与背景图去重）',
  files.filter((f) => f === 'product-5').length === 1,
  '出现 ' + files.filter((f) => f === 'product-5').length + ' 次');
check('所有 URL 都是绝对路径', got.every((x) => /^file:|^https?:/.test(x.url)));

section('7b. URL 归一化与去重（真实站点常见写法）');
check('忽略 #iefix 片段差异',
  H.normalizeForDedupe('https://a.com/i.svg#iefix') === H.normalizeForDedupe('https://a.com/i.svg'));
check('带片段与不带的同一张图只保留一条',
  H.dedupeByUrl([
    { url: 'https://a.com/i.svg' },
    { url: 'https://a.com/i.svg#iefix' }
  ]).length === 1);
check('不同图片不会被误合并',
  H.dedupeByUrl([
    { url: 'https://a.com/i1.svg' },
    { url: 'https://a.com/i2.svg' }
  ]).length === 2);

/* ---------------- 8. 边界情况 ---------------- */

section('8. 边界情况');
const emptyDoc = {
  location: { href: 'https://x.com/' },
  querySelectorAll: () => []
};
check('空页面返回空数组', C.collectImages(emptyDoc, 'https://x.com/', {}).length === 0);

check('background-image 解析双引号',
  C.extractBackgroundUrl('background-image: url("https://a.com/x.png")') === 'https://a.com/x.png');
check('background-image 解析单引号',
  C.extractBackgroundUrl("background-image:url('https://a.com/y.png')") === 'https://a.com/y.png');
check('background-image 无 url() 返回空',
  C.extractBackgroundUrl('background-color: red') === '');

/* ---------------- 汇总 ---------------- */

console.log('\n' + '='.repeat(52));
console.log(`通过 ${pass} 项，失败 ${fail} 项`);
console.log('='.repeat(52));
process.exit(fail ? 1 : 0);
