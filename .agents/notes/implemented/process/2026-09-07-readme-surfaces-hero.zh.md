# Agent Note: README 三形态拼接主视觉

Status: implemented

[English](2026-09-07-readme-surfaces-hero.md) | 中文

## Problem

README 的主视觉此前是一张单独的 Desktop 截图。Oh-DSH 以一个运行时提供
三种交互形态——Desktop、Web 与 TUI——而仓库的入口图只展示了其中一种，
读者会误以为 Desktop 就是产品的全部。静态截图也无法承载各形态在其他
地方赖以区分的皮肤强调色。

## Decision

两份语言的 README 均以 `assets/oh-dsh-surfaces.svg` 作为主视觉：一个
自包含的动画 SVG，在深蓝底板（网格、光晕、鲸鱼品牌水印）上以轻微倾角
叠放三张窗口卡片。

- 三张面板均来自真实界面截取，而非绘制的示意 UI：Desktop 卡沿用现有
  Desktop 截图素材；Web 卡在自绘浏览器外壳中展示 Web 欢迎页截图，
  地址栏为 `127.0.0.1:3080`；TUI 卡在自绘终端标题栏中展示真实 TUI
  截图。
- 卡片强调色对应皮肤标识：Web 青色、Desktop 品牌蓝、TUI 翠绿。取值
  是素材内的字面量，不从 `@oh-dsh/skins` 导入，因为该 SVG 不经过任何
  打包流程。
- 水印使用 `assets/dsh-whale.png` 的近黑色鲸鱼标识，经 SVG
  `feComponentTransfer` 滤镜提亮；蓝色 `assets/icon.svg` 仍是应用
  图标，不作为主视觉品牌标识。
- 动画为 SVG 内置 CSS（卡片浮动、光晕呼吸），带
  `prefers-reduced-motion` 回退且首帧即完整构图，静态渲染器可优雅
  降级。GitHub 通过 `<img>` 提供该图，此上下文会屏蔽 SVG 的外部
  引用，因此所有面板以 base64 内嵌，文件无外部依赖。

官网下载页与 GitHub social preview 暂不更换，仍保留原 Desktop 渲染
图：官网主视觉需要能融入页面相框的透明底素材，而拼接图自带深色圆角
底板，需另行产出透明变体；social preview 还需在仓库设置中手动上传。

该 SVG 以仓库内文件为准；其生成管线（面板截取、裁剪与合成脚本）位于
产出它的 agent 工作流中，不属于仓库。

## Alternatives considered

**保留单张 Desktop 截图。** 无需任何工作，但入口图将继续与 README
正文描述的三形态叙事相矛盾。

**静态 PNG 拼接图。** 管线更简单、无动画顾虑，但位图在 README
`width="100%"` 缩放下会模糊，失去让堆叠"活"起来的动效，也无法按用户
偏好降级。

**引用外部面板文件的 SVG。** SVG 本体更小，但 GitHub 的 `<img>`
上下文屏蔽 SVG 内部的外部引用，主视觉在 GitHub 上会渲染出空面板。

**绘制示意面板而非真实截图。** 视觉完全可控、小尺寸下更锐利，但面板
会偏离真实界面，重新引入主视觉本要解决的可信度问题。

**同一变更内一并更换官网与 social preview。** 一次统一所有入口的视觉，
但两者都需要本变更不具备的前置工作——官网需要透明底变体、预览图需要
手动上传——因此 README 先行、单独成PR。

## Consequences

- 面板内嵌使主视觉约 600 KB；README 多一次资源请求，且面板随界面
  演进而过期：当前展示 TUI v0.1.11 与现有 Web 欢迎页，界面视觉发生
  实质变化时应重新截取。
- 开启"减弱动态效果"或处于静态环境的读者看到的是同一构图的静帧；
  README 不依赖动画运行。
- 在透明底变体落地并完成上传之前，官网下载页与 social preview 仍为
  单张 Desktop 渲染图，各入口的三形态呈现存在过渡期的不一致。
