# Launch notes

## Positioning

Payload Radar helps developers review JSON drift through the fields their own code consumes. The hook remains **Consumer Lens**: an API response can drift in nine places while a checkout UI depends on only two fields. Version **0.3.0** makes that payoff visible immediately, removes format-selection friction for real samples, and makes the result easy to carry into a pull request.

The project combines a static browser workbench, inspectable sample evidence, portable `.lens.json` rules and a zero-dependency CLI. It needs no account, API key, backend or dependency installation. Consumer rules are explicit assumptions the user chooses; baseline observations provide a convenient starting point and do not prove an API contract.

## The demonstration

Open [the checkout Consumer Lens demo](https://qsxustc.github.io/payload-radar/?lens=checkout#consumer-panel). The synthetic checkout comparison is already calculated and its payload editors start collapsed. The Checkout UI lens selects `total` and `items[].quantity` as required numbers, narrowing nine structural findings to two related fields. Its candidate contains five violating observations across those rules. Unrelated drift remains available in the full comparison.

Switch to the order-email lens to see the same API release through a different consumer's needs, or open [that example directly](https://qsxustc.github.io/payload-radar/?lens=email#consumer-panel). The user can edit or remove rules, add a dependent field from the baseline path selector, and export the result. Focus changes the drift view; changing a rule changes the candidate check.

Choose **Use my own JSON** to open a fresh comparison. Untouched demo rules are discarded; explicitly edited or imported rules survive the transition. Paste a pretty-printed JSON response on one side and JSON Lines on the other: the browser detects both independently, labels the result and allows a manual override. A top-level array remains one JSON document. The CLI continues to accept explicit `--format json|jsonl` as before.

After comparing, choose **Copy review summary**. It produces compact Markdown with sample counts, severity totals, structural paths and consumer-check results. Raw sample values are omitted. Users decide where to paste it; the app never posts it or uploads it automatically. A selected-text dialog handles unavailable clipboard access. **Copy demo link** shares the synthetic example only, with no payload or lens content encoded in the link.

A reproducible CLI follow-through from a clone:

```sh
node bin/payload-radar.js check \
  examples/checkout.lens.json examples/checkout-after.jsonl \
  --format jsonl --output checkout-review.md
```

Application repositories can also use `qsxustc/payload-radar@v0.3.0` as a composite GitHub Action with `lens`, `candidate`, and optional `format`, `fail-on`, `report`, and `output` inputs. It sets up Node.js 22 and invokes the same CLI, without a separate Payload Radar clone or dependency installation. The README includes a complete workflow.

The command writes a value-free report and returns 1 because candidate observations violate selected rules. The default check gate catches observed violations. `--fail-on review` also catches rules with no observed values, such as item rules with only empty arrays. Use a new output filename on repeat runs: existing files are never overwritten.

## English launch draft

> Your API response changed in nine places. Does your checkout actually care about all nine?
>
> Payload Radar now opens directly into that review: nine structural findings, two fields your Checkout UI depends on. The example inputs stay folded until you need them. Choose “Use my own JSON,” paste your two responses, and each side detects JSON or JSON Lines independently.
>
> Pick the fields your code reads, set allowed types and required presence, then copy a compact Markdown review into your PR. The summary contains structural facts and explicit consumer-check results, without raw payload values. Export a small `.lens.json` to run the same zero-dependency rules in CI without keeping a baseline payload.
>
> Rules are explicit choices, not proof of a complete API contract. Optional fields may be absent, but present nulls need an allowed null type. Empty arrays provide no item evidence; wholly unobserved rules ask for review.
>
> The live demo needs no account or API key. Payloads stay in the current tab or local CLI process, and sharing never automatically uploads them. I'd appreciate small synthetic cases that expose a confusing result or a step that still gets in the way.

Attach the verified live demo and repository URLs when publishing. Use a real screenshot from the shipped application. Avoid fabricated engagement, benchmarks, user counts, star badges or claims that no other tool has consumer-focused checks.

## 中文发布草稿

> API 返回值变了九处，你的结账页面真的关心全部九处吗？
>
> Payload Radar 现在打开就能看到这份审查：九处结构变化，结账页面只依赖其中两个字段。示例输入默认折叠，先看结果；点击 “Use my own JSON” 再换成自己的响应，两侧分别自动识别 JSON 或 JSON Lines。
>
> 手选代码真正读取的字段、声明允许类型和必填要求，然后一键复制简短 Markdown 到 PR。摘要包含结构事实和明确的调用方检查，不含原始载荷值。也能导出小型 `.lens.json`，在 CI 里复用同一组零依赖规则，不用保存基线载荷。
>
> 规则由使用者明确选择，不代表完整 API 契约得到证明。可选字段允许缺失，但出现 null 时仍需明确允许 null 类型。空数组没有元素证据，完全没观察到值的规则会提示 review。
>
> 演示无需账号和 API Key，载荷只在当前标签页或本地 CLI 进程中处理；复制和分享不会自动上传。欢迎提供不含真实业务数据的边界用例，指出仍然难理解的结果或挡住使用的步骤。

发布时附上已验证的在线体验和仓库链接，以及真实截图。不要把“更有可能帮助用户发现项目”写成保证能获得多少星。

## Input and output limits

The shared engine accepts at most 2 MiB, 1,000 top-level samples, 64 nesting levels and 50,000 visited values per input side. Property names are limited to 1,024 UTF-16 code units. Cumulative structural paths are limited to 4,096 units, counting property lengths plus one separator per property and two units per array-item step.

Diff findings have a separate 2 MiB aggregate location-metadata budget. Each finding's `{ id, path, pointer, tokens }` object is separately JSON-encoded and its UTF-8 bytes counted. This does not cap the whole exported report. Reduce sample groups or shorten field names if a limit is reached.

A Consumer Lens contains one to 100 rules, a trimmed name of one to 80 UTF-16 code units and at most 256 KiB of JSON. Rule paths follow the same core depth/key/path limits. Failure examples are capped at five per rule and a 2 MiB combined concrete-pointer budget; totals still cover every checked match. Lens fields and names can be sensitive even though raw values are omitted.

每侧载荷最多 2 MiB、1,000 个顶层样本、64 层嵌套和 50,000 个被访问的值。字段名和结构路径限制与架构说明一致。Lens 最多 100 条规则、名称最多 80 个 UTF-16 码元，JSON 文件最多 256 KiB。发布介绍应保留这些边界，不宣传成无限大小载荷比较或完整契约验证器。

## Release verification

- Run the complete tests and build; check GitHub CI on the published commit, the executable CLI, and the composite Action from a caller workspace.
- Open the deployed Consumer Lens URLs fresh and check relative assets under the repository subpath.
- Check first-load collapsed editors, direct result links, the own-data entry point, and removal of untouched demo rules while retaining edited/imported rules.
- Compare pretty JSON with JSONL in Auto mode, override each side independently, and verify top-level arrays, malformed-line numbers and safety limits retain their intended meaning.
- Copy the review summary, exercise the manual-copy fallback and copy a demo-only link. Verify no raw payload values or lens contents enter the shared URL.
- Verify checkout and email presets, allowed-type and required edits, adding/removing rules, focused drift, and concrete failure pointers.
- Export a lens, import it into a new session, and run it through the CLI against candidate JSONL. Verify report output survives a failing gate.
- Check optional missing fields, explicit null, empty arrays, invalid lens input, a narrow viewport and keyboard interaction.
- Verify README links, example commands, the actual `assets/first-run-demo.jpg` screenshot, license, release notes and repository description/topics.
- Confirm deployed HTML entry URLs and all relative static module imports carry the same new build ID; stable source rebuilds should reproduce that ID.
- Confirm lens/report exports omit raw values and full baseline shape. Explain that browser lenses need explicit export/import to survive refresh.

## What to learn next

Ask early users which fields their consumers depend on, how they maintain that list, and whether they can act on each failed rule without inspecting private payload values. Prioritize reproducible defects, ambiguous missing/empty-array results and export/import friction.

Possible later directions include integration examples for fetching sanitized candidate samples in CI and richer consumer requirements beyond type/presence. These are ideas, not shipped features or delivery commitments. GitHub stars depend on usefulness and distribution; they are not a measurable promise for this release.
