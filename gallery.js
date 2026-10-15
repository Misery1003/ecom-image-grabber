/* =========================================================
   gallery.js — 展示页逻辑
   ---------------------------------------------------------
   流程：
     1. 从 chrome.storage 读取 content script 提取到的图片列表
     2. 网格渲染 + 勾选（全选 / 反选 / 清空 / 已选计数）
     3. 逐张 fetch → canvas 转 PNG → chrome.downloads.download 保存
   说明：展示页属于扩展页面，拥有 host 权限，所以可以直接
        fetch 跨域图片并用 canvas 转码，不受页面 CORS 限制。
   ========================================================= */
(function () {
  'use strict';

  var H = globalThis.IGHosts || {};

  var STATE_KEY = 'igh:lastExtract';
  var MIN_SIZE = 100;         // 与内容脚本保持一致的过滤阈值
  var DOWNLOAD_GAP = 220;     // 每次下载之间的间隔，避免浏览器丢请求

  var $ = function (id) { return document.getElementById(id); };

  var el = {
    grid: $('grid'),
    empty: $('empty'),
    cardTpl: $('cardTpl'),
    sourceInfo: $('sourceInfo'),
    statTotal: $('statTotal'),
    statSelected: $('statSelected'),
    btnSelectAll: $('btnSelectAll'),
    btnInvert: $('btnInvert'),
    btnClear: $('btnClear'),
    btnDownload: $('btnDownload'),
    downloadLabel: $('downloadLabel'),
    chkFilter: $('chkFilter'),
    progressWrap: $('progressWrap'),
    progressBar: $('progressBar'),
    progressText: $('progressText'),
    progressCount: $('progressCount'),
    toast: $('toast')
  };

  /** 当前页面的全部图片 */
  var items = [];
  /** 已选中的索引集合 */
  var selected = new Set();
  /** 是否正在下载，防止重复点击 */
  var busy = false;

  /* ---------------- 工具 ---------------- */

  var toastTimer = null;
  function toast(msg, ms) {
    el.toast.textContent = msg;
    el.toast.hidden = false;
    void el.toast.offsetWidth;
    el.toast.classList.add('is-show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      el.toast.classList.remove('is-show');
      setTimeout(function () { el.toast.hidden = true; }, 280);
    }, ms || 2600);
  }

  function passFilter(it) {
    if (!el.chkFilter.checked) return true;
    var w = it.width || 0;
    var h = it.height || 0;
    // 尺寸还没探测出来时先显示，等 load 事件回来再决定是否移除
    if (!w || !h) return true;
    return w >= MIN_SIZE && h >= MIN_SIZE;
  }

  function updateStats() {
    el.statSelected.textContent = String(selected.size);
    el.btnDownload.disabled = busy || selected.size === 0;
    // 只改标签文本，不动按钮里的 SVG 图标
    el.downloadLabel.textContent = selected.size
      ? '下载选中（' + selected.size + ' 张 · PNG）'
      : '下载选中（PNG）';
  }

  function refreshCardState(index) {
    var card = el.grid.querySelector('[data-index="' + index + '"]');
    if (card) card.classList.toggle('is-selected', selected.has(index));
  }

  /* ---------------- 渲染 ---------------- */

  function render() {
    el.grid.innerHTML = '';
    var shown = 0;

    items.forEach(function (it, index) {
      if (!it._visible) return;
      shown++;

      var node = el.cardTpl.content.firstElementChild.cloneNode(true);
      node.dataset.index = String(index);
      node.classList.toggle('is-selected', selected.has(index));

      var img = node.querySelector('img');
      var state = node.querySelector('.card__state');
      var sizeEl = node.querySelector('.card__size');
      var srcEl = node.querySelector('.card__source');

      srcEl.textContent = it.source || 'img';
      sizeEl.textContent = it.width && it.height
        ? it.width + ' × ' + it.height
        : '未知尺寸';

      // 图片加载：拿到真实尺寸后补全信息，并按需隐藏
      img.addEventListener('load', function () {
        it.loaded = true;
        it.width = img.naturalWidth || it.width;
        it.height = img.naturalHeight || it.height;
        sizeEl.textContent = it.width + ' × ' + it.height;
        if (!passFilter(it)) {
          it._visible = false;
          node.remove();
          updateEmpty();
        }
      });
      img.addEventListener('error', function () {
        it.failed = true;
        state.hidden = false;
        state.classList.add('is-error');
        state.textContent = '图片加载失败（可能已失效）';
      });
      img.src = it.url;
      img.alt = '商品图片 ' + (index + 1);

      var checkbox = node.querySelector('.card__checkbox');
      checkbox.checked = selected.has(index);
      checkbox.addEventListener('change', function () {
        if (checkbox.checked) selected.add(index); else selected.delete(index);
        node.classList.toggle('is-selected', checkbox.checked);
        updateStats();
      });

      el.grid.appendChild(node);
    });

    el.statTotal.textContent = String(shown);
    updateStats();
    updateEmpty();
  }

  function updateEmpty() {
    var hasVisible = items.some(function (it) { return it._visible; });
    el.empty.hidden = hasVisible;
    el.grid.hidden = !hasVisible;
  }

  /* ---------------- 读取数据 ---------------- */

  function readState() {
    return new Promise(function (resolve) {
      try {
        chrome.storage.local.get([STATE_KEY], function (obj) {
          resolve((obj && obj[STATE_KEY]) || null);
        });
      } catch (e) {
        resolve(null);
      }
    });
  }

  function load() {
    // 调试/演示入口：gallery.html?state=<base64(JSON)>
    // 便于在不经过页面提取的情况下直接预览展示与下载流程
    var injected = readInjectedState();
    if (injected) { applyState(injected); return; }

    readState().then(function (state) {
      if (!state || !state.images || !state.images.length) {
        el.sourceInfo.textContent = '暂无数据';
        items = [];
        render();
        return;
      }
      applyState(state);
    });
  }

  /** 解析 ?state= 参数（base64 编码的 JSON） */
  function readInjectedState() {
    try {
      var raw = new URLSearchParams(location.search).get('state');
      if (!raw) return null;
      var json = decodeURIComponent(escape(atob(raw)));
      var obj = JSON.parse(json);
      return obj && obj.images ? obj : null;
    } catch (e) {
      console.warn('[图提取] ?state= 参数解析失败：', e.message);
      return null;
    }
  }

  /** 把一份提取结果渲染到界面上 */
  function applyState(state) {
    items = state.images.map(function (it) {
      return {
        url: it.url,
        width: it.width || 0,
        height: it.height || 0,
        source: it.source || 'img',
        _visible: true
      };
    });

    var where = state.platform ? state.platform + ' · ' : '';
    var title = (state.pageTitle || '').slice(0, 48);
    el.sourceInfo.textContent = where + title + '  ·  ' + items.length + ' 张';
    el.sourceInfo.title = state.pageUrl || '';

    // 默认全选，符合"提取完就想要"的直觉
    items.forEach(function (_, i) { selected.add(i); });
    render();
  }

  /* ---------------- PNG 转换与下载 ---------------- */

  /**
   * 把一张图片转成 PNG Blob。
   * 先尝试 createImageBitmap（更快），失败则退回 <img> + canvas（兼容 svg 等）。
   */
  function toPngBlob(url) {
    return fetchImageBlob(url).then(function (blob) {
      if (typeof createImageBitmap === 'function') {
        return createImageBitmap(blob).then(function (bitmap) {
          var c = document.createElement('canvas');
          c.width = bitmap.width;
          c.height = bitmap.height;
          c.getContext('2d').drawImage(bitmap, 0, 0);
          if (bitmap.close) bitmap.close();
          return canvasToBlob(c);
        }).catch(function () {
          return viaImageElement(blob);
        });
      }
      return viaImageElement(blob);
    });
  }

  function fetchImageBlob(url) {
    return fetch(url, { credentials: 'omit', cache: 'force-cache' }).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.blob();
    });
  }

  /** 退回 <img> 解码路径 */
  function viaImageElement(blob) {
    return new Promise(function (resolve, reject) {
      var objUrl = URL.createObjectURL(blob);
      var img = new Image();
      img.onload = function () {
        try {
          var w = img.naturalWidth || img.width;
          var h = img.naturalHeight || img.height;
          if (!w || !h) throw new Error('无法获取图片尺寸');
          var c = document.createElement('canvas');
          c.width = w;
          c.height = h;
          c.getContext('2d').drawImage(img, 0, 0, w, h);
          canvasToBlob(c).then(resolve, reject);
        } catch (e) {
          reject(e);
        } finally {
          URL.revokeObjectURL(objUrl);
        }
      };
      img.onerror = function () {
        URL.revokeObjectURL(objUrl);
        reject(new Error('图片解码失败'));
      };
      img.src = objUrl;
    });
  }

  /** canvas → PNG Blob（toBlob 比 toDataURL 省内存） */
  function canvasToBlob(canvas) {
    return new Promise(function (resolve, reject) {
      canvas.toBlob(function (blob) {
        if (blob) resolve(blob);
        else reject(new Error('PNG 编码失败'));
      }, 'image/png');
    });
  }

  function downloadBlob(blob, filename) {
    return new Promise(function (resolve, reject) {
      var objUrl = URL.createObjectURL(blob);
      chrome.downloads.download(
        { url: objUrl, filename: filename, saveAs: false },
        function (downloadId) {
          // 下载任务已入队即可释放；浏览器会在后台完成写入
          setTimeout(function () { URL.revokeObjectURL(objUrl); }, 60000);
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve(downloadId);
          }
        }
      );
    });
  }

  /** 顺序下载，逐张更新进度 */
  function downloadSelected() {
    if (busy || !selected.size) return;
    busy = true;
    updateStats();

    var list = Array.from(selected).sort(function (a, b) { return a - b; });
    var total = list.length;
    var ok = 0;
    var failures = [];

    el.progressWrap.hidden = false;
    el.progressBar.style.width = '0%';
    el.progressText.textContent = '正在转换并下载…';
    el.progressCount.textContent = '0 / ' + total;

    function step(i) {
      if (i >= total) {
        // 收尾
        busy = false;
        el.progressText.textContent = failures.length
          ? '完成：成功 ' + ok + ' 张，失败 ' + failures.length + ' 张'
          : '全部下载完成，共 ' + ok + ' 张 PNG';
        el.progressCount.textContent = total + ' / ' + total;
        updateStats();
        setTimeout(function () { el.progressWrap.hidden = true; }, 4000);
        toast(failures.length
          ? '完成：成功 ' + ok + ' 张，失败 ' + failures.length + ' 张'
          : '已下载 ' + ok + ' 张 PNG 到浏览器默认下载目录');
        if (failures.length) {
          console.warn('[图提取] 以下图片下载失败：\n' + failures.join('\n'));
        }
        return;
      }

      var index = list[i];
      var it = items[index];
      var filename = H.buildFileName
        ? H.buildFileName(i, '商品图', 'png')
        : '商品图_' + (i + 1) + '.png';

      el.progressText.textContent = '正在处理第 ' + (i + 1) + ' / ' + total + ' 张…';

      toPngBlob(it.url)
        .then(function (blob) { return downloadBlob(blob, filename); })
        .then(function () {
          ok++;
        })
        .catch(function (err) {
          failures.push(it.url + '  →  ' + err.message);
        })
        .then(function () {
          var pct = Math.round(((i + 1) / total) * 100);
          el.progressBar.style.width = pct + '%';
          el.progressCount.textContent = (i + 1) + ' / ' + total;
          setTimeout(function () { step(i + 1); }, DOWNLOAD_GAP);
        });
    }

    step(0);
  }

  /* ---------------- 事件绑定 ---------------- */

  el.btnSelectAll.addEventListener('click', function () {
    items.forEach(function (it, i) { if (it._visible) selected.add(i); });
    render();
  });

  el.btnInvert.addEventListener('click', function () {
    items.forEach(function (it, i) {
      if (!it._visible) return;
      if (selected.has(i)) selected.delete(i); else selected.add(i);
    });
    render();
  });

  el.btnClear.addEventListener('click', function () {
    selected.clear();
    render();
  });

  el.chkFilter.addEventListener('change', function () {
    items.forEach(function (it) {
      it._visible = it.loaded ? passFilter(it) : true;
    });
    render();
  });

  el.btnDownload.addEventListener('click', downloadSelected);

  // 快捷键：Ctrl/Cmd + A 全选，Enter 下载
  document.addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      el.btnSelectAll.click();
    } else if (e.key === 'Enter' && !el.btnDownload.disabled) {
      e.preventDefault();
      downloadSelected();
    }
  });

  load();
})();
