# DiaboliX

DiaboliX is a local harness for OpenAI-compatible models. LangGraph coordinates a planner, a tool-using worker, and a reviewer. The roles can use separate models; each additional model call increases token usage and latency.

> [!CAUTION]
> **Trading is not even alpha software.** It is an unfinished reminder of a possible future idea, not a usable feature. Do not use the Trading profile, exchange integrations, or trading tools for real trading, paper trading, investment decisions, or financial analysis. They are not validated, may behave unpredictably, and must not be trusted with money or accounts. Use the Coding profile.

## Getting started

You need Node.js 20 or later, Docker Engine or Docker Desktop, and permission to use Docker. From the project directory, run:

```sh
npm install
docker build -t diabolix-sandbox:local sandbox
npm start
```

Open [http://localhost:6660](http://localhost:6660). Enter an OpenAI-compatible endpoint, an API key if required, a model, and an absolute path to the project. Model discovery uses `/models`; the agent uses `/chat/completions` with tool calling. For a local API, enter an address reachable from the computer running Node.js.

The connection settings let you choose a general reasoning effort and optional overrides for the planner, worker, and reviewer. A role can inherit the general setting or use its provider's default. The default omits the `reasoning_effort` parameter; other choices send it with each role's chat requests. Available and effective levels depend on the model and provider, which may reject or ignore unsupported values. Longer reasoning requests have a five-minute per-attempt timeout and remain cancellable with Stop.

Settings are saved in `config.local.json`. By default, the API key remains in process memory; you can explicitly choose to save it locally. The current model conversation remains in process memory; task events are stored separately as described below.

## Working profiles

The profile selector in the header switches between **Coding** (the default) and **Trading** and saves the choice in `config.local.json`. Both use the configured MCP server, and both retain its web tools. Coding excludes MCP tools named `exchange_*`, the former `paper_exchange_*` names, and common trading aliases; it omits the built-in trading prompts. Trading exposes the complete MCP tool list and trading instructions. Role model settings are shared by the two profiles, while chat context, read cache, and session telemetry are kept separately. In Telegram, `/set profile coding` and `/set profile trading` change the same setting.

If MCP is unavailable, Coding emits a warning and continues with built-in tools; Trading reports the connection failure. Filtering is based on tool names, not a security boundary: an external server can expose trading capabilities under other names, and enabled Computer Use has its own permissions. Connect only trusted servers.

## Isolation

The web server and provider requests run on the host. Built-in tools run in short-lived Docker containers without the Docker socket, as an unprivileged user with a read-only root filesystem and limits on CPU, memory, and process count. Ordinary commands have no network access. The dedicated dependency installer uses a temporary isolated Docker network and a separate proxy restricted to the official npm and PyPI hosts.

The selected project is mounted read-write at `/workspace`: changes affect the actual files on the host. Do not select your entire home directory or keep secrets in the selected folder. The agent can use `install_dependencies` to install npm packages into the project or Python packages into a project-local `.venv`; these persist across commands and the root project's virtual environment is added to the command PATH. The Python environment is intended for the Linux sandbox, not for use directly on the host. Installation can change package manifests and lock files. The installer defaults to disabling npm lifecycle scripts and allowing only binary Python wheels; the agent can enable scripts or Python source builds when required. Such code can modify the mounted project. Packages that download binaries from other hosts may fail because the proxy only permits `registry.npmjs.org`, `pypi.org` and `files.pythonhosted.org`. A container is not a substitute for a full virtual machine; its security depends on Docker and the host. On Linux, the selected folder may need to be writable by UID 1000. If Docker or the sandbox image is unavailable, tools return an error and do not run on the host.

The system prompt describes this isolation to the model. On cancellation or timeout, the container is forcibly removed. The provider receives the task and tool results, so choose a provider you trust.

## Built-in web MCP server

DiaboliX starts its own MCP endpoint at `http://127.0.0.1:6660/mcp` alongside the web UI and uses it by default. The endpoint exposes `web_search` and `read_web_page`. When Computer Use is enabled, it also exposes the task-scoped `computer` tool. Its random per-process bearer token is held by the local DiaboliX process; the endpoint is not intended for direct browser access. The MCP server runs on the host, outside the agent's network-isolated Docker sandbox.

Choose **Automatic**, **Tavily**, or **Brave Search** in the connection settings. In Automatic mode, DiaboliX uses Tavily when its key is configured, then Brave when its key is configured, then the unofficial DuckDuckGo HTML endpoint, with a limited Wikipedia fallback. A selected provider reports errors instead of silently switching services. The result identifies its provider; public HTML endpoints may change or be unavailable.

Enter the Tavily or Brave Search API key in the UI, or set `TAVILY_API_KEY` or `BRAVE_SEARCH_API_KEY` before starting DiaboliX. A UI key takes precedence over the corresponding environment variable. Keys remain in memory by default; each can optionally be saved in `config.local.json` without encryption. Keys are not returned to the browser. You can remove a UI key in settings; an environment key remains active if set. For example, to configure Tavily without the UI:

```sh
export TAVILY_API_KEY='your-key'
npm start
```

The page reader accepts public HTTP(S) pages on standard ports and returns limited plain text. It does not execute JavaScript. Requests to loopback, private, link-local and other non-public addresses are blocked, including DNS answers and redirects. Responses, redirects, request duration and concurrency are limited. Web content and MCP tool outputs are untrusted data; queries and retrieved content may be sent to the search provider and the configured model provider. The two web tools are read-only; the optional Computer Use tool can modify the workspace.

You may replace the MCP URL in settings with another trusted Streamable HTTP server, or clear it to disable MCP. External MCP servers execute tools outside the Docker sandbox, with their own permissions. External MCP authentication and stdio connections are not currently supported.

## Trading: future idea only

**Do not use Trading.** The Trading profile and associated exchange code are unfinished experiments that have not reached alpha testing. They are retained solely as a reminder of a possible future direction. Their presence is not an endorsement of use and does not indicate that trading behavior, risk controls, market data, or results are reliable. Do not connect real accounts, place trades, run paper-trading sessions, or base financial decisions on this code.

## Telegram bot

Create your own bot with [BotFather](https://t.me/BotFather), obtain your numeric Telegram user ID from a trusted client or bot, and enter both in **Connection → Telegram Bot**. Enable Telegram control, save the settings, then open your bot in Telegram and send `/start`. The connection status appears in the settings. DiaboliX must remain running on your computer and be able to reach the Telegram Bot API.

Only messages in a private chat where both the sender ID and chat ID match the configured numeric ID are accepted. Group messages, forwarded messages, and messages sent before the current connection started are ignored. The bot uses long polling, so no incoming public port is needed. Long polling requires a dedicated bot without an active webhook; DiaboliX reports an existing webhook and does not delete it. Do not run another poller with the same bot token.

Send a task as ordinary text or `/task <task>`. The bot sends agent messages and completion or error notifications, including for tasks started from the web UI. Commands: `/status`, `/logs` (download the event log), `/stop`, `/new`, `/changes` (download the task diff), `/screen` (latest Computer Use screenshot), `/rollback` (roll back the completed task), `/models`, `/settings`, `/set <name> <value>`, and `/help`. The help message lists configurable names. Only one task can run at a time, and settings cannot be changed while it is running. Telegram linking and its allowed ID are managed in the local UI. Attachments are limited to 40 MB and `/changes` uses the shadow-checkpoint exclusions described below.

The bot token is saved in `config.local.json` **without encryption by default**, with owner-only file permissions. You can disable this in settings; the token then remains only in memory and must be entered again after a restart. Removing the token disconnects the bot. The API returns only a presence flag, not the token. Tasks, messages, diffs and screenshots sent via the bot pass through Telegram; commands containing API keys remain in the Telegram chat history. Prefer entering credentials in the local UI. The configured local settings file is masked inside the built-in sandbox and Computer Use containers when it lies in the mounted workspace. This does not protect copies of the file or external MCP servers running on the host.

## Limitations

This is an early harness implementation. It does not provide persistent model conversation history, command approval, or a full sandbox for third-party MCP servers. The project uses LangGraph for Node.js.

## Agent workflow

Before planning, the agent surveys the project in the container. A file map and AST symbols are passed to MCTS; symbols are also indexed when Neo4j is configured. The settings allow separate planner, worker, and reviewer models; an empty role field falls back to the main model. After execution, the reviewer receives a diff of changed files and can read files and search code. It can request up to two revision cycles. Repeated identical tool calls are guarded against.

`read_file` supports windows of up to 250 lines; `search_code` returns up to 50 matches; `patch_file` edits a single exact match and supports rollback. `write_file` creates files and permits explicit `overwrite: true`. Identical patch replacements are rejected; missing and ambiguous targets produce distinct suggestions. Reconnaissance excludes dependency and build directories, lock files, and binary files. The map contains only paths and symbol names, is limited to 6 KB, and covers up to 300 ranked text files from up to 30,000 discovered paths; ranking by task terms is heuristic and can omit relevant files. The reviewer's diff is generated separately from Shadow Git across included text files and is output-limited. If it is truncated, the reviewer should inspect files with its tools.

After changing sandbox code, rebuild the image:

```sh
docker build -t diabolix-sandbox:local sandbox
```

Ordinary commands have no network access; dependency installation uses the restricted temporary network described above. Synchronous Python and Node.js commands can use normal shell redirections such as `2>&1`, quoted arguments and heredocs. Background servers and daemons are prohibited by the instructions and checked by a command filter for common shell operators and server invocations. The filter cannot reliably identify every possible server or infinite program, especially in scripts or complex shell syntax; Docker isolation and command timeouts remain in effect.

## Local settings and Full Auto

Coding mode supports **Quick** (one plan), **Standard** (the existing bounded plan selection), and **Deep** (an additional read-only researcher with a four-tool budget before planning). Reports are untrusted and must be checked by the worker. Deep mode takes additional model calls and time. The selected mode is persisted in settings.

Settings are stored in `config.local.json`, which is excluded from Git. If you enable key persistence, the key is written to this file **without encryption**, with owner-only file permissions. The configured settings file is masked inside DiaboliX's containers, but copies of secrets and third-party host tools are not protected by this mask. The API does not return keys. To remove a saved key, disable the checkbox and save the settings.

Full Auto disables the user-configured step limit but retains an emergency limit of 500 steps per task and repeated-call protection. This mode can increase API costs. Click **Stop** to interrupt execution.

The tool context retains full results from the last four model interactions with tools; older results are replaced with brief summaries. Unchanged repeated reads are suppressed while the original result remains in the context window; once it is compressed, the file can be read again. The stable system prompt does not contain the dynamic plan or project map. Actual server-side prompt caching depends on the provider and request parameters.

## Checkpoints, telemetry, and long contexts

Task events are stored as local JSONL files in `.diabolix-sessions/` beside the config, with owner-only permissions. The directory is ignored by Git and masked inside the built-in containers when it is in the workspace. The journal contains task text and tool results, so it can contain project data; configured API and bot keys are redacted and screenshots omitted, but arbitrary secrets in project data cannot be reliably identified. History is viewable after a restart. A task without a terminal event is marked interrupted, not successful. The history shows up to 100 recent tasks.

An explicit **Continue** starts a new attempt with the original task and recorded tool statuses, rather than replaying an old model conversation or restoring a LangGraph checkpoint. It is restricted to the same coding workspace, confirmed read and file-write tools, and matching hashes for verified file changes; unconfirmed writes, in-flight calls, shell commands, and external tools require manual review instead. The new attempt has a new rollback baseline. This check does not prove that every other file or external state stayed unchanged.

Tool events include structured status evidence separate from model summaries. A short window of statuses is included in subsequent prompts; it is not proof that the full task is complete. The worker and reviewer can use `read_task_evidence` to list recent actual tool results and retrieve a result by event ID after context compaction (long results are truncated). A repeated identical review with unchanged answer and file tree stops after three repetitions in coding mode.


A separate temporary Git repository is created outside the project for the current task. It stores the initial state and intermediate text-file changes without modifying the project's `.git`. After the task finishes, its changes can be rolled back to the initial state. Rollback is rejected if text files changed after the task finished; changes made manually *during* the task cannot be automatically distinguished from the agent's changes.

Binary files, symbolic links, `.env*`, `config.local.json`, and generated dependency and cache directories including `.git`, `node_modules`, `.venv`, `venv`, `__pycache__`, `dist`, `build`, `.next`, and `coverage` are excluded from snapshots and rollback. Installed dependencies are therefore not removed by task rollback. Temporary data contains copies of source code and is removed when the next task starts; it may remain in the system temporary directory after a crash. The current task's checkpoint and rollback do not persist across server restarts.

Changes are checked automatically: JavaScript with `node --check`, JSON by parsing, and TypeScript with local `tsc --noEmit` when both `tsconfig.json` and the compiler are available. Otherwise, the reason for skipping the check is reported. Events are delivered over SSE; token statistics depend on the provider including `usage` in its responses. The context-compaction threshold is approximate, based on character count, and does not guarantee that a request fits a particular model's context window. A root-level `DIABOLIX.md` or `.diabolixrules` file is read at the start of a task, up to 4 KB.

When a model-provider API request fails, DiaboliX makes up to ten retries at 30-second intervals after the initial attempt. The console shows the retry count, and stopping a task interrupts both a request and the wait. An unsupported reviewer image is handled immediately by the existing text-only fallback.

After a file change, **Summary changes** opens a complete, color-coded diff against the start of the current task. New files appear as added lines. The view uses the same exclusions as the shadow checkpoint above and remains available after a page refresh while the task's checkpoint exists; it is replaced when a new task starts or the server restarts.

## Computer Use

Computer Use is an opt-in, experimental graphical desktop for the **agent**, separate from your host desktop. Build the desktop image once:

```sh
docker build -t diabolix-computer:local computer
```

In connection settings, enable **Computer Use** and select an OpenAI-compatible worker model that supports image input and tool calling. The worker discovers and invokes the `computer` tool through the built-in authenticated MCP server. When needed, the agent starts a dedicated Linux desktop containing Chromium and a terminal; the interface shows screenshots after actions. The agent can open HTTP(S) URLs or `about:blank`, take screenshots, click, double-click, move and drag the mouse, scroll, type, press supported keys, and wait. For navigation, DiaboliX waits for Chromium to report the active document URL and completed load before capturing the result; a timeout is reported as an error with a screenshot rather than a confirmed page load. The desktop lives for the current task and is removed on completion or stop. It has no host display, Docker socket, or host clipboard. Networking is off by default; enable **Allow internet for the desktop** in settings to browse websites. When enabled, the container uses Docker bridge networking without destination filtering and can also reach accessible local-network addresses. The separate web-search MCP tools keep their own network restrictions.

Chromium runs with its own sandbox disabled (`--no-sandbox`) inside the restricted Docker container. Browser sandboxing is disabled even when internet access is enabled. The selected project is mounted read-write: applications in the desktop can modify its files, including through the terminal. Screenshots can contain project data and are sent to the configured model provider; enable the feature only for data and providers you trust. The screenshot pane is an observation view, not an interactive remote desktop or a human takeover control. This is not a full Claude Desktop equivalent: it does not control your Mac, provide human takeover, or implement every native computer-use protocol. The worker model and provider must accept image input in OpenAI-compatible Chat Completions. If the image is unavailable, rebuild it with the command above.

File creation and edits are checked by comparing the resulting file hash with the intended contents. The sandbox also runs post-edit diagnostics: JavaScript and Python syntax checks, JSON validation, or TypeScript type checks when a local compiler and configuration are available. The agent is instructed not to create or run automated tests unless the user explicitly requests them.

## Synthetic evaluation

`npm run eval` runs small synthetic coding tasks in temporary workspaces, with independent checks in Docker. Set `DIABOLIX_EVAL_ENDPOINT` and `DIABOLIX_EVAL_MODEL`; `DIABOLIX_EVAL_API_KEY` is optional. `DIABOLIX_EVAL_MODE` selects quick, standard or deep; `DIABOLIX_EVAL_CASE` optionally selects one case, and `DIABOLIX_EVAL_TIMEOUT_MS` sets the per-case timeout. Results and redacted event logs are saved under `.diabolix-eval-results/`, which is excluded from Git. These fixtures are smoke tests, not a SWE-bench score or a comprehensive quality benchmark.

Use `node eval/compare.js <report-a.json> <report-b.json>` to compare reports. The comparison flags different models or case IDs and reports token usage only when supplied by the provider. Repeated runs are needed to estimate variability.
