# SmartPlanner

SmartPlanner is a browser-based planner for study, projects, and everyday work. Add available hours, fixed commitments, tasks, deadlines, and dependencies; the page recalculates immediately and explains work it cannot fit. Confirmed work stays in place when plans change.

**Try it:** [open SmartPlanner](https://smartplanner-youyong5.sharpbow12.chatgpt.site/). The page runs entirely in the browser, with no account or server database. Data is saved in that browser's local storage; use **导出 JSON** for a portable backup. Clearing browser storage or changing devices will not carry the data over automatically.

For a GitHub Pages address, set **Settings → Pages → Build and deployment → Source** to **GitHub Actions**, then run **Actions → Publish GitHub Pages → Run workflow**. The workflow builds and tests the same static site before publishing. Once deployment succeeds, use the URL shown in the workflow's `github-pages` environment; the Pages site is separate from this repository's code view. This setup requires repository administration access and is not enabled by the source files alone.

## Run locally

Requires Node.js 20+; no package installation is needed.

```sh
npm test
npm run build
```

Serve `dist/` over HTTP with any static server, for example `python3 -m http.server 4173 -d dist`, then visit `http://localhost:4173/`. Opening `index.html` directly with `file://` cannot fetch the examples reliably. `npm run check` runs tests and builds the deployable folder.

## Use

Choose **学期安排** or **项目交付** to explore the example. **新建计划** creates seven local-day availability windows, which you can edit. Add tasks and fixed activities, open a task row to adjust its minutes or deadline, mark a task complete, or lock/unlock an arranged block. Locked blocks remain at their times; conflicts are shown explicitly. Each scenario saves separately in your browser. **重置示例** replaces that scenario's local edits. The imported plan becomes **我的计划**.

Dates appear without a year. Enter them as `MM/DD HH:mm`, for example `10/21 17:00`. The year remains in the stored plan and is inferred from the nearby plan date when you edit a field; a date near New Year can roll into the adjacent year. For plans spanning more than six months across a year boundary, use JSON import to choose the exact year. Dates and times in exported JSON are not shortened.

Exported files contain `app_version: 1`, a `plan` using the original version 1 plan format, and separate `display` labels. The importer also accepts a bare DeadlinePlan version 1 plan JSON. Times in the plan are signed Int32 UTC minutes since the Unix epoch; all intervals are half-open `[start, end)`. The page formats and accepts times in the visitor's local timezone. A task with `minimum_block_minutes` may be split; without it, the task needs one continuous slot. The scheduler orders ready tasks by earliest deadline, breaking ties by input order. It is deterministic and **does not guarantee a globally optimal schedule**.

## Code

- `src/planner.js`: JavaScript port of the reusable scheduling and validation rules, with no MoonBit build dependency.
- `src/date-display.js`: year-free display and input parsing, without changing the plan document.
- `app.js`, `index.html`, `styles.css`: browser interaction and responsive UI.
- `data/`: original academic and project examples. Their labels and locations live in the presentation layer.
- `tests/`: parity and edge-case checks for the port, including confirmed progress, dependencies, rollback, schema errors, and time boundaries.
- `scripts/build.mjs`: copies static assets into `dist/` for static hosting. GitHub Actions tests the project and retains this build as an artifact; the live experience link above is deployed separately. `.github/workflows/pages.yml` is ready for GitHub Pages when enabled in repository settings.

This project adapts [DeadlinePlan](https://github.com/youyong5/DeadlinePlan) by the same author. The earlier project supplied the scheduling rules, versioned input format, example plans, and initial visual layout; SmartPlanner ports the core to JavaScript and adds a user-facing workflow for creating, editing, locally saving, importing, and exporting plans. Both projects are licensed under Apache-2.0; see [LICENSE](LICENSE). No MoonBit source or runtime is required by this repository.

The interface loads Nunito Sans from Google Fonts and 975Maru SC from the cn-fontsource webfont CDN. 975Maru SC is derived from open fonts under the SIL Open Font License 1.1; when either CDN is unavailable, system sans-serif fonts are used.
