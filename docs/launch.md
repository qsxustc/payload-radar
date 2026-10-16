# Launch notes

## Positioning

Payload Radar helps developers review structural drift in JSON payload samples. Its useful moment is concrete: an API response still parses as JSON, but a number becomes a string, a field stops appearing, or a nullable branch reaches a consumer that did not expect it.

The project combines a static browser evidence inspector and a local CLI. It needs no account, API key, server or dependency installation. It should be introduced as a practical review aid with explicit sample-inference limits.

## Input and output limits

The shared engine accepts at most 2 MiB, 1,000 top-level samples, 64 nesting levels and 50,000 visited values per input side. A property name may contain at most 1,024 UTF-16 code units. Each cumulative structural path may contain at most 4,096 units, counting property lengths plus one separator per property and two units per array-item step.

Findings have a separate location-metadata budget: the sum of the UTF-8 lengths of each JSON-encoded `{ id, path, pointer, tokens }` object must not exceed 2 MiB. This does not cap the whole exported report. If a limit is reached, reduce the representative sample group or shorten field names. Avoid marketing the tool as an unlimited-file diff or a full contract verifier.

输入每侧最多 2 MiB、1,000 个顶层样本、64 层嵌套和 50,000 个被访问的值。字段名最多 1,024 个 UTF-16 码元，累计结构路径最多 4,096 个码元；属性按字段名长度加一个分隔符计数，数组元素步骤计两个码元。每项发现的 `{ id, path, pointer, tokens }` 对象分别 JSON 编码后的 UTF-8 大小合计最多 2 MiB，此预算不是完整报告的大小上限。发布介绍应保留这些边界。

## English launch draft

> I built Payload Radar: a local-first JSON shape diff with a browser evidence inspector and a zero-dependency CLI.
>
> Give it before/after JSON or JSONL samples. It finds new types, fields no longer observed, nullability and presence changes, then lets you inspect the sample evidence behind each finding.
>
> You can export a Markdown review, JSON findings or a candidate JSON Schema draft. The CLI can gate CI on review severity. Payloads stay in the browser tab or local process.
>
> It infers observations, so it cannot prove your API contract or guarantee compatibility. Empty arrays and sparse samples are called out explicitly.
>
> Try the built-in checkout and webhook examples. I'd especially appreciate synthetic cases where a finding is confusing or the evidence could be clearer.

Attach the verified live demo and repository URLs when publishing. Use the real application screenshot from `assets/demo.jpg`; avoid fabricated engagement, benchmarks, user counts or star badges.

## 中文发布草稿

> 做了一个开源工具 Payload Radar，用来检查 JSON 样本的结构变化：金额从数字变成字符串、字段没有再出现、空值和字段出现率变化，都能看到对应样本证据。
>
> 浏览器直接使用，另有零依赖 CLI，可以导出 Markdown、JSON 报告和 JSON Schema 草稿，也能给 CI 加检查条件。数据只在当前标签页或本地进程里处理，无需账号和 API Key。
>
> 它基于样本观察，不会把“没出现”说成已经证明“被删除”，也不能证明 API 契约完整兼容。内置结账 API 和 Webhook 的合成示例，可以直接体验。
>
> 欢迎反馈难以理解的检查结果，也欢迎提供不含真实业务数据的边界用例。

发布时附上已验证的在线体验和仓库链接，以及真实截图。

## Release verification

- Run the complete tests and build; check GitHub CI on the published commit.
- Open the deployed URL, including a fresh browser visit, and check that relative assets load under the repository subpath.
- Walk through the checkout, webhook and stable examples. Check a selected finding, search, severity filters and downloads.
- Import local JSON and JSONL files. Check an invalid input, a narrow viewport and keyboard interaction.
- Verify the README demo link and screenshot, license, release notes and repository description/topics.
- Confirm reports and schema exports contain no raw example values, while explaining that field and file names remain visible.

## What to learn next

Ask early users which changes escaped their current review and whether each finding provides enough context to act. Prioritize reproducible engine defects and confusing evidence before adding more inference rules.

Possible follow-up directions, each requiring design and validation: optional comparison against a supplied JSON Schema, user-approved finding baselines, broader CI examples and large-input processing. These are ideas, not shipped features or delivery commitments. GitHub stars depend on usefulness and distribution; they are not a measurable promise for this release.
