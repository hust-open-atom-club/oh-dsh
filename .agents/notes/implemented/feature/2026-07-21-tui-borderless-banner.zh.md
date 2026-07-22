# Agent Note: 横幅回归，无边框

Status: implemented

[English](2026-07-21-tui-borderless-banner.md) | 中文

## Problem

[移除横幅 Agent Note](2026-07-21-tui-no-banner.md) 删掉了带框的启动横幅：它删除了 `HeaderComponent` 及其扫入动画，把模型移入页脚，丢弃了会话 id，并把 `welcome` 渲染为 transcript 的第一行。用户的裁决把这一切反转：把横幅拿回来——"just remove the border"。令人反感的装饰是那四行盒子边框，而不是它承载的识别信息（模型、会话 id），也不是扫入动效。

## Decision

- `HeaderComponent` 及其从左到右的扫入动画回归，但以**无边框**方式渲染：没有 `╭─╮`/`╰─╯` 边角，也没有 `│` 侧边。每一行都是一个前导空格加上经 `truncateToWidth` 裁剪的内容，因此扫入的宽度裁剪永远不会撕裂转义序列，也不绘制任何固定边框。
- 头部承载标题（`DEEPSEEK HARNESS`）、一条 `<model>  •  <session-id>` 详情行，以及——当设置了 `welcome` 时——一条弱化的副标题。`welcome` 未设置时头部只有标题加详情。
- 模型**同时**保留在页脚的左段。移除横幅那版 note 加入的页脚模型前缀被保留而非回退，因此在短暂的横幅滚出视野后，会话使用的模型仍可一瞥可见。
- `welcome` 恢复为横幅副标题；transcript 第一行的通知从 `rebuildTranscript` 中移除。
- 仅当 `welcome` 未设置时才播放扫入动画。配置了 `welcome` 会立即渲染整个横幅，使 fixture 和快照保持帧确定性。扫入在 `ui.start()` 成功后启动，并经与之前相同的 `detachListeners` 路径通过 `stopBannerReveal` 清理；后者还会重置裁剪，使扫入中途被销毁的头部重新完整渲染。

本 note 取代[移除横幅 Agent Note](2026-07-21-tui-no-banner.md)（后者取代了[横幅扫入 Agent Note](2026-07-21-tui-banner-sweep.md)）：横幅及其扫入动画以无边框方式回归，而移除横幅那版 note 为模型设立的页脚归宿得以保留。

## Alternatives considered

**保留盒子但做细或改用更轻的字符。** 否决：指令是 "just remove the border"；任何环绕的字符都是用户所反对的边框装饰。

**既然横幅重新显示模型，就把模型从页脚移除。** 否决：横幅是短暂的，会随 transcript 滚走，而页脚在整个会话中保持模型可见——这正是移除横幅那版 note 把它放在那里的原因，此处刻意保留。

**像移除横幅那版 note 那样，把会话 id 留在外面。** 否决：盒子去掉后详情行只占一行，且用户要求横幅"和以前一样"，而以前它承载 `model • session-id`。

## Consequences

- `welcome` 未设置时的启动输出再次依赖动画（扫入）；配置了欢迎语则保持帧确定性，因此每个快照和脚本 fixture 都保留一个固定副标题。
- 模型现在在启动时出现两次——横幅详情与页脚——这是有意的冗余：横幅短暂，页脚常驻。
- `/clear` 清空 transcript 但不清头部，因此横幅及其配置的副标题在 `/clear` 后存活，不同于被 `/clear` 清掉的移除横幅那版的欢迎行。
- 全部 pi-tui 终端快照与 examples/tui-agent 回放快照重新录制（`test:snapshot:refresh`）：横幅行以无盒子字符方式回归；页脚行保留模型前缀。
- 一切锚定横幅缺失的内容改为锚定其存在：PTY 冒烟测试以详情行的 `main-session-` id 为启动标记（它在扫入后段才被揭示），并断言 `DEEPSEEK`/`HARNESS` 出现且无盒子角。

## Testing

`packages/ui/tui/tests/tui.spec.ts` 固定：无边框横幅扫入至自然完成——无盒子角、标题与 `main-session` 详情出现——且至少有一帧扫入中途被裁剪；配置的 `welcome` 完整渲染横幅且无裁剪帧；未设置 `welcome` 的横幅无副标题；销毁会在扫入中途清掉扫入定时器。tui-agent 与 dsh CLI 的 PTY 冒烟测试以 `main-session-` 详情标记为启动标记并断言无盒子角。快照验证完整帧。
