<h1 align="center">多媒体对比工具</h1>

<p align="center">极简的桌面端在线工具，并排对比图片、动图与视频。</p>

<p align="center">
  <a href="https://github.com/chenlongapps/image-comparison-tool/actions/workflows/nextjs.yml"><img alt="GitHub Pages 部署状态" src="https://img.shields.io/github/actions/workflow/status/chenlongapps/image-comparison-tool/nextjs.yml?style=flat-square&amp;branch=main&amp;label=deploy" /></a>
  <a href="LICENSE"><img alt="MIT 许可证" src="https://img.shields.io/badge/license-MIT-yellow?style=flat-square" /></a>
</p>

<p align="center">
  <a href="README.md">English</a> | <strong>简体中文</strong><br />
  <a href="https://chenlongapps.github.io/image-comparison-tool/">在线体验</a> | <a href="https://image-compare.chenlong716.dpdns.org/">备用链接</a>
</p>

[![多媒体对比工具预览](image.png)](https://chenlongapps.github.io/image-comparison-tool/)

---

## 功能

- 图片、GIF、APNG、动画 WebP 与视频任意组合对比。
- 同步缩放和平移，解锁后可独立调整两侧画面以对齐。
- 动图与视频支持播放、暂停和进度控制。
- 支持拖拽、文件选择和剪贴板粘贴。
- 文件在浏览器本地处理，不上传服务器。
- 自动跟随系统深色模式，支持 English / 简体中文界面。

## 使用

将文件拖入左右面板，点击选择，或使用 `Ctrl+V` / `Cmd+V` 粘贴。

| 操作 | 方式 |
| --- | --- |
| 平移 | 拖拽或触控板双指滑动；纯图片模式下可用方向键 |
| 缩放 | 鼠标滚轮、捏合或 `+` / `−` 按钮（0.1×–10×） |
| 播放 / 暂停 | 播放按钮或空格键 |
| 调整进度 | 拖动进度条，或用 `←` / `→` 每次调整 0.5 秒 |
| 重置 / 清空 | 重置恢复视图并暂停到起点；清空移除两侧文件 |

点击锁定按钮切换联动或独立控制。锁定时两侧一起播放、暂停，并按各自时长的相同百分比定位，而非相同秒数；播放速度、循环次数和自然结束各自独立。

<details>
<summary>动图与剪贴板注意事项</summary>

- 动图加载后停在首帧，单帧动图按静态图片处理；进度条表示一次循环。
- 粘贴优先填充空面板，两侧都有文件时替换左侧。只有剪贴板提供原始动图文件才能保留动画，单张位图按静态图片处理。
- 动图按需解码，画面最多 400 万像素，单边不超过 4096 像素；标签仍显示原始尺寸。跳转进度可能需要等待，降采样会减少细节。解码失败时保留之前加载的媒体。
- 视频静音只影响该侧面板。

</details>

## 本地开发

推荐使用 Node.js 22 LTS（22.12 或更新的 22.x 版本）及 npm。项目基于 Next.js、React 和 TypeScript。

```bash
npm ci
npm run dev
```

访问 [localhost:3000](http://localhost:3000)。

检查、构建与生产预览：

```bash
npm run lint
npx tsc --noEmit
npm test
npm run build
npm start
```

生产构建将静态文件导出到 `out/`，包含动画 WebP 解码器。部署到 GitHub Pages 等子路径时：

```bash
NEXT_PUBLIC_BASE_PATH=/image-comparison-tool npm run build
```

部署配置见 [GitHub Pages 工作流](.github/workflows/nextjs.yml)。

## 许可证

[MIT](LICENSE)
