# Launch notes

## Positioning

Payload Radar helps developers review JSON drift through the fields their own code consumes. The concrete hook for v0.2 is **Consumer Lens**: an API response can drift in nine places while a checkout UI depends on only two fields. Select those dependencies, state allowed types and presence, then check candidate samples locally or in CI.

The project combines a static browser workbench, inspectable sample evidence, portable `.lens.json` rules and a zero-dependency CLI. It needs no account, API key, backend or dependency installation. Consumer rules are explicit assumptions the user chooses; baseline observations provide a convenient starting point and do not prove an API contract.

## The demonstration

Open [the checkout Consumer Lens demo](https://qsxustc.github.io/payload-radar/?lens=checkout). The synthetic checkout comparison has nine structural findings. The Checkout UI lens selects `total` and `items[].quantity` as required numbers, narrowing related drift to two fields. Its candidate contains five violating observations across those rules. Unrelated drift remains available in the full comparison.

Switch to the order-email lens to see the same API release through a different consumer's needs, or open [that example directly](https://qsxustc.github.io/payload-radar/?lens=email). The user can edit or remove rules, add a dependent field from the baseline path selector, and export the result. Focus changes the drift view; changing a rule changes the candidate check.

A reproducible CLI follow-through from a clone:

```sh
node bin/payload-radar.js check \
  examples/checkout.lens.json examples/checkout-after.jsonl \
  --format jsonl --output checkout-review.md
```

Application repositories can also use `qsxustc/payload-radar@v0.2.0` as a composite GitHub Action with `lens`, `candidate`, and optional `format`, `fail-on`, `report`, and `output` inputs. It sets up Node.js 22 and invokes the same CLI, without a separate Payload Radar clone or dependency installation. The README includes a complete workflow.

The command writes a value-free report and returns 1 because candidate observations violate selected rules. The default check gate catches observed violations. `--fail-on review` also catches rules with no observed values, such as item rules with only empty arrays. Use a new output filename on repeat runs: existing files are never overwritten.

## English launch draft

> Your API response changed in nine places. Does your checkout actually care about all nine?
>
> I added Consumer Lens to Payload Radar. Pick only the fields your code reads, set their allowed types and required presence, and check candidate JSON/JSONL samples against those rules. The built-in checkout example narrows nine structural findings to two dependent fields.
>
> Export a small `.lens.json`, commit it with your app, and run the same zero-dependency check in CI without keeping a baseline payload. A reusable GitHub Action makes that a single `uses` step. The browser also shows sample numbers and concrete paths behind failures. Lenses and reports contain no raw sample values.
>
> Rules are explicit choices, not proof of a complete API contract. Optional fields may be absent, but present nulls need an allowed null type. Empty arrays provide no item evidence; wholly unobserved rules ask for review.
>
> The live demo runs without an account or API key, and payloads stay in the current browser tab or local CLI process. I'd appreciate small synthetic cases that expose confusing check results or missing workflow details.

Attach the verified live demo and repository URLs when publishing. Use a real screenshot from the shipped application. Avoid fabricated engagement, benchmarks, user counts, star badges or claims that no other tool has consumer-focused checks.

## 中文发布草稿

> API 返回值变了九处，你的结账页面真的关心全部九处吗？
>
> 给开源工具 Payload Radar 加了 Consumer Lens：手选代码真正读取的字段，声明允许类型和必填要求，再检查候选 JSON / JSONL 样本。内置结账示例可将九处结构变化聚焦到两个依赖字段。
>
> 浏览器导出一个小的 `.lens.json`，提交到应用仓库，就能在 CI 里跑同一组零依赖检查，不用保留基线载荷。配套 GitHub Action 只需一个 `uses` 步骤即可接入。失败结果有样本编号和具体路径；Lens 和报告不包含原始样本值。
>
> 规则由使用者明确选择，不代表完整 API 契约得到证明。可选字段允许缺失，但出现 null 时仍需明确允许 null 类型。空数组没有元素证据，完全没观察到值的规则会提示 review。
>
> 演示无需账号和 API Key，载荷只在当前标签页或本地 CLI 进程中处理。欢迎提供不含真实业务数据的边界用例，帮助把结果和工作流做得更清楚。

发布时附上已验证的在线体验和仓库链接，以及真实截图。不要把“更有可能帮助用户发现项目”写成保证能获得多少星。

## Input and output limits

The shared engine accepts at most 2 MiB, 1,000 top-level samples, 64 nesting levels and 50,000 visited values per input side. Property names are limited to 1,024 UTF-16 code units. Cumulative structural paths are limited to 4,096 units, counting property lengths plus one separator per property and two units per array-item step.

Diff findings have a separate 2 MiB aggregate location-metadata budget. Each finding's `{ id, path, pointer, tokens }` object is separately JSON-encoded and its UTF-8 bytes counted. This does not cap the whole exported report. Reduce sample groups or shorten field names if a limit is reached.

A Consumer Lens contains one to 100 rules, a trimmed name of one to 80 UTF-16 code units and at most 256 KiB of JSON. Rule paths follow the same core depth/key/path limits. Failure examples are capped at five per rule and a 2 MiB combined concrete-pointer budget; totals still cover every checked match. Lens fields and names can be sensitive even though raw values are omitted.

每侧载荷最多 2 MiB、1,000 个顶层样本、64 层嵌套和 50,000 个被访问的值。字段名和结构路径限制与架构说明一致。Lens 最多 100 条规则、名称最多 80 个 UTF-16 码元，JSON 文件最多 256 KiB。发布介绍应保留这些边界，不宣传成无限大小载荷比较或完整契约验证器。

## Release verification

- Run the complete tests and build; check GitHub CI on the published commit, the executable CLI, and the composite Action from a caller workspace.
- Open the deployed Consumer Lens URLs fresh and check relative assets under the repository subpath.
- Verify checkout and email presets, allowed-type and required edits, adding/removing rules, focused drift, and concrete failure pointers.
- Export a lens, import it into a new session, and run it through the CLI against candidate JSONL. Verify report output survives a failing gate.
- Check optional missing fields, explicit null, empty arrays, invalid lens input, a narrow viewport and keyboard interaction.
- Verify README links, example commands, screenshot, license, release notes and repository description/topics.
- Confirm lens/report exports omit raw values and full baseline shape. Explain that browser lenses need explicit export/import to survive refresh.

## What to learn next

Ask early users which fields their consumers depend on, how they maintain that list, and whether they can act on each failed rule without inspecting private payload values. Prioritize reproducible defects, ambiguous missing/empty-array results and export/import friction.

Possible later directions include integration examples for fetching sanitized candidate samples in CI and richer consumer requirements beyond type/presence. These are ideas, not shipped features or delivery commitments. GitHub stars depend on usefulness and distribution; they are not a measurable promise for this release.
