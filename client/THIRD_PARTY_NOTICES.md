# 第三方开源组件

本客户端没有复制 Eagle 的程序、图标、商业素材或授权逻辑。Eagle 仅为当前本机交互与数据格式参考，名称不表示与其官方关联。

| 组件 | 版本 | 实际使用 | 许可与来源 |
|---|---|---|---|
| Electron | 45.1.0 | macOS 窗口、沙盒、文件选择与预览协议 | MIT；https://github.com/electron/electron ，运行包保留 LICENSE 与 LICENSES.chromium.html |
| Fuse.js | 7.1.0 | 素材名称、标签、描述文本搜索 | Apache-2.0；https://github.com/krisk/Fuse ，node_modules/fuse.js/LICENSE |
| TagSpaces common | 4.8.9 | paths.js 文件扩展名与路径解析；配套 AppConfig.js | MIT；https://github.com/tagspaces/tagspaces-common ；src/vendor/LICENSE-tagspaces-common |
| TagSpaces search | 4.8.9 | filters.js 标签组合筛选 | MIT；同上模块仓库；src/vendor/LICENSE-tagspaces-search |
| Lucide | 0.577.0 | 界面 SVG 图标 | ISC；https://github.com/lucide-icons/lucide ；src/vendor/LICENSE-lucide |

TagSpaces npm 发布的 gitHead 为 `35a1d601cc47a62745eea22b0dc2861569679f40`。裁剪文件保留版权；仅更改 require 路径指向本地 AppConfig.cjs。未复制 AGPL 主应用的实现、未使用可选 Pro 模块。完整上游源码在项目 upstream/，作为调研参考，不打进应用。

应用图标由本项目脚本绘制，不使用 Eagle 图标。完整第三方授权条款随对应文件保留。尚未确认本项目公开范围，项目自身源码暂标 UNLICENSED。
