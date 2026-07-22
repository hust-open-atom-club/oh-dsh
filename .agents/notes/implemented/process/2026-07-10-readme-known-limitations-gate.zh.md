# Agent Note: 在每个 package README 中设置受门禁保护的 Known Limitations 章节

Status: implemented

[English](2026-07-10-readme-known-limitations-gate.md) | 中文

## 问题

[文档标准](../../../../docs/AGENTS.md)规定限制项归属包 README。没有共享形状时，缺少章节无法区分“经审计确认没有限制”与“忘记编写文档”，不同的标题还会妨碍全仓库搜索。

## 决策

`packages/<group>/<pkg>/package.json` 下的每份包清单都有一个同级 README，其中包含规范的 `## Known Limitations and Deferred Work` 章节。其项目符号记录由该包拥有的持久消费者缺口和不明显的维护者约束；普通清理仍留在源码 TODO 或所属 Agent Note（agent 决策记录）中。[`verify-package-readme-limitations` 门禁](../../../../scripts/verify-package-readme-limitations.ts)从清单推导包集合，拒绝缺失 README，并要求恰好一个规范 h2 且至少包含一个顶层项目符号。“Limitations”“Deferred”“What is NOT here”或“Non-goals”等近似标题都会失败。

如果一个包确实没有需要声明的限制事项，则将其列入 `NO_LIMITATIONS` 并省略该章节。新增限制事项时须移除该条目；重命名或移除条目会失败，因为每个条目都必须对应一个被扫描的包。

门禁检查存在性、形状和允许列表。按照文档与[正文](../../../skills/dsh-prose-standard/SKILL.md)标准进行的评审负责覆盖面和准确性。常设规则位于 [packages/AGENTS.md](../../../../packages/AGENTS.md)。

## 曾考虑的替代方案

- **自由格式标题**：无法统一搜索，仍需近似标题检测。
- **要求空章节或写 "None."**：样板文字可能在包新增限制事项后仍然残留；白名单使「确无限制」这一状态显式且可评审。
- **设置字数上限**：合理的限制事项数量因包而异，因此由评审管控这一不设预算的 README 层级。

## 后果

- 新建的包须声明符合条件的限制事项，或显式加入白名单；缺失、漂移或空的章节会在本地和 CI 的 `doc-sync` 中失败。
- 门禁为 `doc-sync` 新增一个无外部依赖的 TypeScript 脚本。
- 重命名受强制的标题需要同时修改脚本和所有 package README。
