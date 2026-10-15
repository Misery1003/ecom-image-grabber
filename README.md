# 图提取 · 电商图片下载插件

一键提取**淘宝 / 天猫 / 京东 / 拼多多商家版**商品详情页的全部图片，在新页面集中预览、勾选，并批量下载为 **PNG**。

Chrome / Edge 浏览器扩展（Manifest V3）· 本地运行 · 不收集任何数据。

- 在线官网：<https://misery1003.github.io/ecom-image-grabber/>
- 仓库地址：<https://github.com/Misery1003/ecom-image-grabber>

## 功能

| 能力 | 说明 |
| --- | --- |
| 右下角悬浮按钮 | 仅在支持的平台注入，文案「获取图片」，圆角带阴影，不遮挡平台原生操作 |
| 一键提取 | 扫描 `<img>`、`srcset`、`data-src` / `data-original` / `data-ks-lazyload` 等懒加载属性，以及 CSS 背景图 |
| 智能过滤 | 排除图标、LOGO、占位图、1×1 像素，以及小于 100×100 的图片；极端长条也剔除 |
| 自动去重 | 相对路径补全为绝对路径；忽略 `#iefix` 之类的片段差异，同一张图只保留一条 |
| 集中预览 | 新标签页网格展示，含尺寸信息与来源标注（img / srcset / lazy / background） |
| 自由勾选 | 全选、反选、清空选择、按尺寸筛选，已选数量实时显示 |
| 统一 PNG | jpg / webp / png 统一经 canvas 转码为 PNG |
| 批量下载 | 保存到浏览器默认下载目录，文件名自动编号 `商品图_001.png`，带进度与结果反馈 |

## 目录结构

```
ecom-image-grabber/
├── manifest.json          MV3 清单
├── background.js          Service Worker：消息转发、打开展示页
├── gallery.html           图片展示页
├── gallery.css
├── gallery.js             勾选与 PNG 批量下载
├── js/
│   ├── hosts.js           域名匹配、URL 归一化、过滤规则（纯函数）
│   ├── collect.js         页面图片扫描（纯逻辑，可单测）
│   └── content.js         按钮注入与交互
├── css/
│   └── content.css        注入到页面的样式
├── icons/                 插件图标（16/32/48/128）
├── docs/                  官方宣传网站（GitHub Pages 发布目录）
├── demo/
│   ├── product-page.html  本地模拟商品详情页，用于测试
│   ├── selfcheck.html     注入自检页
│   └── assets/            演示图片
└── tests/
    └── collect.test.js    58 项单元测试
```

## 安装

1. 下载本项目（或 `git clone`）。
2. 打开 `chrome://extensions` 或 `edge://extensions`。
3. 打开右上角「开发者模式」。
4. 点击「加载已解压的扩展程序」，选择本项目根目录。

## 使用

打开任意商品详情页，右下角会出现蓝色「获取图片」按钮：

1. 点击按钮 → 自动扫描并跳转到图片展示页；
2. 在展示页勾选需要的图片（默认全选）；
3. 点击「下载选中（PNG）」，图片保存到浏览器默认下载目录。

## 本地测试

核心逻辑做了可测试拆分，不依赖浏览器即可运行单元测试：

```bash
node tests/collect.test.js
```

覆盖范围：平台域名匹配（含仿冒域名防护）、详情页判定、URL 补全与安全过滤、
`srcset` 取最大图、尺寸过滤、去重归一化、真实页面的扫描结果、背景图解析等。

也可以起一个本地服务，打开模拟商品页做端到端验证：

```bash
python -m http.server 5700
# 浏览器打开 http://127.0.0.1:5700/demo/product-page.html
```

> 模拟页里刻意混入了各种真实站点的图片写法：`srcset`、懒加载 `data-*` 属性、
> CSS 背景图，以及应当被过滤掉的 LOGO / 图标 / 1×1 占位图。

## 官网

`docs/` 目录是纯静态宣传网站，无构建步骤、无外部依赖，可直接双击 `docs/index.html` 预览。
推送到 GitHub 后，在仓库 **Settings → Pages** 里把发布目录设为 `docs/` 即可获得公开访问地址。

## 技术要点

- **权限最小化**：只申请 `activeTab` / `scripting` / `downloads` / `storage`，
  `host_permissions` 仅覆盖四个平台域名。
- **跨域处理**：展示页属于扩展页面，拥有 host 权限，可直接 `fetch` 图片并用 canvas 转 PNG，
  不受页面 CORS 限制。
- **平台差异兼容**：不同站点的懒加载属性名不同，统一在 `collect.js` 的 `LAZY_ATTRS` 中列举。
- **可测试性**：扫描逻辑抽到 `collect.js`，不碰 `chrome` API，因此能在 Node 里用假 DOM 单测。

## 已知限制

- 图片由 JavaScript 动态渲染且尚未插入 DOM 时，首次点击可能提取不到，滚动加载后再点一次即可。
- 平台改版可能导致详情页判定失效，此时可在地址后加 `?igh-scan` 强制注入按钮（调试用）。
- 需要登录才能查看的图片无法获取。

## 许可

仅用于学习与个人使用。请遵守各电商平台的服务条款，勿用于侵犯他人权益的用途。
