# Agent Note: 落地页页脚的俱乐部社区链接

Status: implemented

[English](2026-08-26-website-club-community-links.md) | 中文

## Problem

落地页页脚原本只有产品标语，网站没有提供进入俱乐部 QQ 群或 Discord 服务器的入口。而俱乐部的 QQ 分享链接只会打开一个中转加群页，不会直达群本身。

## Decision

页脚以 `1fr auto 1fr` 网格将两个社区链接居中放在品牌名与右对齐的标语之间（窄视口下堆叠居中），两个标志均以品牌色呈现：Discord 标志使用其品牌蓝紫（`#5865F2`）。Discord 指向俱乐部公布的邀请链接（`https://discord.gg/EMJqcQCCpW`）。QQ 链接以俱乐部分享页（`https://qm.qq.com/q/2uEd11lkWk`）作为 `href`，普通左键点击会先导航到
`mqqapi://card/show_pslcard?src_type=internal&version=1&uin=554359007&card_type=group&source=qrcode`，
在已安装的 QQ 客户端中直接打开群卡片；两秒内没有任何客户端认领该 scheme 时，改为打开分享页。带修饰键的点击和非左键点击会跳过该处理，保持原生分享页导航。

## Alternatives considered

**只链接分享页。** 不采用：它会在进入群之前插入一个中转页面，这正是俱乐部希望去掉的摩擦。

**只暴露 mqqapi scheme。** 不采用：未安装 QQ 客户端的浏览器会得到一个没有恢复路径的死链接。

## Consequences

在装有 QQ 的设备上，普通点击一跳直达群卡片；在其他环境仍会落在一个可用的加群页。scheme 内嵌的群号（554359007）是从俱乐部分享链接解码得到的，href 与 scheme 只有在单独修改其中之一时才会漂移；Discord 邀请链接是俱乐部自己发布的 URL，可能独立轮换。Discord 标志为 simple-icons 图形（CC0 路径数据），与俱乐部 GitHub 徽章经 shields.io `logo=discord` 使用的是同一图形。QQ 标志采用腾讯 qun.qq.com 加群页自身提供的企鹅几何数据，重着色为 QQ 品牌蓝（`#12B7F5`），保证在页脚尺寸下仍能认出站立的吉祥物；该图形为腾讯商标，这里仅为链接俱乐部群聊作指称性使用。两者均以内联 SVG 呈现，没有新增图片资源，链接文案走站点既有的翻译表。

## Testing

`node --check website/site.js` 通过。在没有 QQ 客户端的浏览器中点击页脚 QQ 链接，两秒内回退到俱乐部分享页并落在 QQ 加群页面；桌面端与 390px 移动端页脚截图中两个链接的图标渲染完好。`node scripts/verify-agent-note-format.ts`、
`node scripts/verify-agent-note-classification.ts` 与 `node scripts/verify-translation-pairing.ts` 通过。
