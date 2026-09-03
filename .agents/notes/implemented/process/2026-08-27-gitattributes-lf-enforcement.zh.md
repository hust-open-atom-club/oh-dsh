# Agent Note: .gitattributes 强制全平台 LF

Status: implemented

[English](2026-08-27-gitattributes-lf-enforcement.md) | 中文

## Problem

仓库此前没有 `.gitattributes`，检出后的行尾跟随每个贡献者各自的 `core.autocrlf`。
Windows 上常见的 `autocrlf=true` 会把工作区所有文本文件变成 CRLF。双语文档配对
工具按工作区的精确字节计算哈希，因此在这类检出上用 `--write` 记录的 sidecar 捕获
的是 CRLF 内容的 blob 哈希，而 Git 仓库里实际存储的是 LF blob；Linux 上的 CI 随即
对本地看起来完全一致的内容报出 `verify-translation-pairing` 的 "out of sync"。
同样的换行转换还让每个 `.i18n.yaml` 在本地被解析为 malformed，导致这台机器上的
门禁永远无法通过：CRLF 检出静默地废掉了本地证据回路，把字节级漂移检测完全推给
了 CI。

## Decision

`.gitattributes` 现在声明 `* text=auto eol=lf`：文本文件在索引中归一化为 LF，
并且所有平台检出时都得到 LF，不再受 `core.autocrlf` 影响。Windows 脚本扩展名
（`.bat`、`.cmd`、`.ps1`）固定为工作区 CRLF，因为 cmd.exe 与部分 PowerShell
执行策略无法正确解析纯 LF 脚本（现有两个 Windows 脚本本来就是 LF 且继续工作；
该规则保护未来的新脚本）。常见二进制资产（`*.icns`、`*.png`)标记为 `binary`，
归一化永远不会触碰它们；仓库中其余二进制文件已被自动检测识别为 `-text`。十一
个提交内容本身含 CRLF 的源码文件（sidebar 插件八个文件与三个测试文件，自首次
提交起就是 CRLF）和两个混合行尾的 Agent Note 在本次变更中一并归一化为 LF，两
个受影响的配对 sidecar 也已按归一化后的字节重新记录。检出行尾不再依赖个人 Git
配置；CI 与贡献者机器计算的是相同的字节。

## Alternatives considered

- **只修正 `usage.i18n.yaml` 里记录的哈希，并在文档中写明“别用 autocrlf”。**
  否决：下一次新克隆或任何配置不当的贡献者都会让问题复发，README 说明无法让
  检出变得确定——这正是问题反复出现的原因。
- **要求每位贡献者按文档设置 `autocrlf=input`。** 否决原因相同：配置不随仓库
  走，attributes 则随仓库分发，作用于每次克隆和未来所有表面（编辑器格式化、
  归档导出）。
- **让配对语料不再按字节哈希，绕开检出字节问题。** 否决：按字节精确的一致性
  记录正是捕获双语真实漂移的机制；放宽契约去容忍 CRLF 会掩盖未来的编码损坏。
- **包括 Windows 脚本在内全部 LF。** 否决：cmd.exe 批处理解析对纯 LF 标签有
  已知的怪癖，PowerShell 执行策略也各有差异；把三个脚本扩展名钉在 CRLF 上以
  零成本消除了这一风险。

## Consequences

- 所有平台检出相同字节；`verify-translation-pairing` 在贡献者机器与 CI 上给出
  一致判定，恢复了 Windows 上的推送前证据回路。
- 一次性 diff 噪音：归一化改动了提交字节确有变化的文件（CRLF/混合行尾源码转
  LF）；这些行的 blame 在此后指向本次提交。
- 读取精确字节的工具链（配对 sidecar）恢复稳定；过去依赖 `autocrlf=true` 的贡
  献者在重新检出后无需额外操作，因为 attributes 优先于 config。
- 之后新增的文件自动继承规则；新增的真正二进制格式若无扩展名匹配，需自行添加
  `binary` attribute 或依赖 `-text` 自动检测。
- 归一化的幸存者：受跟踪 blob 中无一残留，已通过 `git ls-files --eol` 验证本次
  变更后仅剩 `i/lf`、`i/-text` 与子模块条目。
