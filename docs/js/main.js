/* deployed-rev: 5d2f397 */
/* =========================================================
   图提取官网 · 交互脚本
   功能：
     1. 滚动时导航栏吸顶加深
     2. 滚动监听，高亮当前所在区块的导航项
     3. 移动端汉堡菜单展开 / 收起
     4. IntersectionObserver 实现元素进入视口淡入上移
   纯原生实现，无任何依赖。
   ========================================================= */
(function () {
  'use strict';

  var nav = document.getElementById('nav');
  var navLinks = document.getElementById('navLinks');
  var navToggle = document.getElementById('navToggle');
  var links = Array.prototype.slice.call(document.querySelectorAll('.nav__link[href^="#"]'));

  /* ---------------- 1. 导航栏吸顶效果 ---------------- */
  function onScrollNav() {
    if (nav) nav.classList.toggle('is-scrolled', window.scrollY > 8);
  }
  window.addEventListener('scroll', onScrollNav, { passive: true });
  onScrollNav();

  /* ---------------- 2. 滚动高亮当前区块 ---------------- */
  // 收集导航指向的区块
  var sections = links
    .map(function (a) { return document.querySelector(a.getAttribute('href')); })
    .filter(Boolean);

  function highlight() {
    // 以视口上方 1/3 处作为判定线
    var line = window.scrollY + window.innerHeight / 3;
    var current = null;
    sections.forEach(function (sec) {
      if (sec.offsetTop <= line) current = sec;
    });
    links.forEach(function (a) {
      var target = a.getAttribute('href');
      a.classList.toggle('is-active', !!current && target === '#' + current.id);
    });
  }
  window.addEventListener('scroll', highlight, { passive: true });
  window.addEventListener('resize', highlight);
  highlight();

  /* ---------------- 3. 移动端汉堡菜单 ---------------- */
  function closeMenu() {
    if (!navLinks || !navToggle) return;
    navLinks.classList.remove('is-open');
    navToggle.setAttribute('aria-expanded', 'false');
    navToggle.setAttribute('aria-label', '展开菜单');
  }

  if (navToggle && navLinks) {
    navToggle.addEventListener('click', function () {
      var open = navLinks.classList.toggle('is-open');
      navToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      navToggle.setAttribute('aria-label', open ? '收起菜单' : '展开菜单');
    });

    // 点击菜单项后自动收起
    links.forEach(function (a) { a.addEventListener('click', closeMenu); });

    // 点击页面其他区域或按 Esc 也收起
    document.addEventListener('click', function (e) {
      if (!navLinks.classList.contains('is-open')) return;
      if (navLinks.contains(e.target) || navToggle.contains(e.target)) return;
      closeMenu();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeMenu();
    });
    // 视口变宽时重置
    window.addEventListener('resize', function () {
      if (window.innerWidth > 767) closeMenu();
    });
  }

  /* ---------------- 4. 滚动进入视口的淡入动画 ---------------- */
  var revealEls = document.querySelectorAll('.reveal');

  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-in');
        io.unobserve(entry.target); // 只播一次
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });

    revealEls.forEach(function (el) { io.observe(el); });
  } else {
    // 老浏览器直接显示，不做动画
    revealEls.forEach(function (el) { el.classList.add('is-in'); });
  }

  /* ---------------- 5. 仓库与下载链接 ---------------- */
  var REPO_URL = 'https://github.com/Misery1003/ecom-image-grabber';
  var repoLink = document.getElementById('repoLink');
  var downloadBtn = document.getElementById('downloadBtn');
  if (repoLink) repoLink.href = REPO_URL;
  if (downloadBtn) {
    // 压缩包直链：GitHub 会自动打包默认分支
    downloadBtn.href = REPO_URL + '/archive/refs/heads/main.zip';
  }
})();
