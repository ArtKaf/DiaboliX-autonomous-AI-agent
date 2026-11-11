# DiaboliX

DiaboliX is a local harness for OpenAI-compatible models. LangGraph coordinates a planner, a tool-using worker, and a reviewer. The roles can use separate models; each additional model call increases token usage and latency.

## Getting started

You need Node.js 20 or later, Docker Engine or Docker Desktop, and permission to use Docker. From the project directory, run:

```sh
npm install
docker build -t diabolix-sandbox:local sandbox
npm start
```

Open [http://localhost:6660](http://localhost:6660). Enter an OpenAI-compatible endpoint, an API key if required, a model, and an absolute path to the project. Model discovery uses `/models`; the agent uses `/chat/completions` with tool calling. For a local API, enter an address reachable from the computer running Node.js.

Settings are saved in `config.local.json`. By default, the API key remains in process memory; you can explicitly choose to save it locally. Conversation history remains in process memory.

## Isolation

The web server and provider requests run on the host. Each built-in tool runs in a separate, short-lived Docker container without network access or the Docker socket. The container runs as an unprivileged user with a read-only root filesystem and limits on CPU, memory, and process count.

The selected project is mounted read-write at `/workspace`: changes affect the actual files on the host. Do not select your entire home directory or keep secrets in the selected folder. Because the container has no network access, commands cannot install packages from the network or interact with remote infrastructure. A container is not a substitute for a full virtual machine; its security depends on Docker and the host. On Linux, the selected folder may need to be writable by UID 1000. If Docker or the sandbox image is unavailable, tools return an error and do not run on the host.

The system prompt describes this isolation to the model. On cancellation or timeout, the container is forcibly removed. The provider receives the task and tool results, so choose a provider you trust.

## Built-in web MCP server

DiaboliX starts its own MCP endpoint at `http://127.0.0.1:6660/mcp` alongside the web UI and uses it by default. The endpoint exposes `web_search` and `read_web_page`. Its random per-process bearer token is held by the local DiaboliX process; the endpoint is not intended for direct browser access. The MCP server runs on the host, outside the agent's network-isolated Docker sandbox.

Choose **Automatic**, **Tavily**, or **Brave Search** in the connection settings. In Automatic mode, DiaboliX uses Tavily when its key is configured, then Brave when its key is configured, then the unofficial DuckDuckGo HTML endpoint, with a limited Wikipedia fallback. A selected provider reports errors instead of silently switching services. The result identifies its provider; public HTML endpoints may change or be unavailable.

Enter the Tavily or Brave Search API key in the UI, or set `TAVILY_API_KEY` or `BRAVE_SEARCH_API_KEY` before starting DiaboliX. A UI key takes precedence over the corresponding environment variable. Keys remain in memory by default; each can optionally be saved in `config.local.json` without encryption. Keys are not returned to the browser. You can remove a UI key in settings; an environment key remains active if set. For example, to configure Tavily without the UI:

```sh
export TAVILY_API_KEY='your-key'
npm start
```

The page reader accepts public HTTP(S) pages on standard ports and returns limited plain text. It does not execute JavaScript. Requests to loopback, private, link-local and other non-public addresses are blocked, including DNS answers and redirects. Responses, redirects, request duration and concurrency are limited. Web content and MCP tool outputs are untrusted data; queries and retrieved content may be sent to the search provider and the configured model provider. Only read-only web tools are exposed by this built-in server.

You may replace the MCP URL in settings with another trusted Streamable HTTP server, or clear it to disable MCP. External MCP servers execute tools outside the Docker sandbox, with their own permissions. External MCP authentication and stdio connections are not currently supported.

## Limitations

This is an early harness implementation. It does not provide persistent conversation history, command approval, or a full sandbox for third-party MCP servers. CrewAI, Pydantic AI, and AutoGen are not integrated; the project uses LangGraph for Node.js.

## Planning, AST, and rollback

The planner uses a bounded MCTS: up to two model-proposed plans and four evaluation simulations, selected using UCB. These are model assessments, not actual code executions, and they add API calls and cost. If the planner returns an invalid response, its text is used without search.

The `parse_ast` tool parses JavaScript/JSX and Python in the sandbox and returns up to 300 declarations and imports. To use `index_graph`, set `NEO4J_URI`, `NEO4J_USER`, `NEO4J_PASSWORD`, and optionally `NEO4J_DATABASE` before starting the server. It stores a file node and its AST elements with `CONTAINS` relationships; this is a symbol index, not a complete graph of dependencies between files. Data from the selected file is sent to the configured Neo4j database. The host server, not the container, connects to the database.

The agent is instructed to run tests before and after changes using `run_tests`. A baseline check is required before writing a file or running a shell command. After changes, the agent must obtain a successful `run_tests` result or report a blocking reason through `report_test_blocker`. This controls the sequence of built-in tools, but does not assess the quality of the chosen test command or restrict external MCP tools.

The agent can call `rollback_last_write` to undo the last supported `write_file` or `patch_file` operation in the current task if the file still matches the agent's written content. These per-file checkpoints are held in memory, apply to files up to 1 MB, and disappear after the task; they do not undo shell commands, MCP operations, or Neo4j changes. Use version control and backups for comprehensive recovery.

## Agent workflow

Before planning, the agent surveys the project in the container. A file map and AST symbols are passed to MCTS; symbols are also indexed when Neo4j is configured. The settings allow separate planner, worker, and reviewer models; an empty role field falls back to the main model. After execution, the reviewer receives a diff of changed files and can read files and search code. It can request up to two revision cycles. Repeated identical tool calls are guarded against.

`read_file` supports windows of up to 250 lines; `search_code` returns up to 50 matches; `patch_file` edits a single exact match and supports rollback. `write_file` creates new files only. Reconnaissance excludes dependency and build directories, lock files, and binary files. The map contains only paths and symbol names, is limited to 6 KB, and covers up to the first 300 text files. The reviewer's diff is generated separately from Shadow Git across included text files and is output-limited. If it is truncated, the reviewer should inspect files with its tools.

After changing sandbox code, rebuild the image:

```sh
docker build -t diabolix-sandbox:local sandbox
```

The container has no network access. Background servers and daemons are prohibited by the instructions and partially checked by a command filter; the filter is not a complete defense against arbitrary shell syntax.

## Local settings and Full Auto

Settings are stored in `config.local.json`, which is excluded from Git. If you enable key persistence, the key is written to this file **without encryption**, with owner-only file permissions. The agent may be able to access the file if the DiaboliX directory is selected as its workspace; do not select it as the workspace when a key is saved. The API does not return the key. To remove a saved key, disable the checkbox and save the settings.

Full Auto disables the user-configured step limit but retains an emergency limit of 500 steps per task and repeated-call protection. This mode can increase API costs. Click **Stop** to interrupt execution.

The tool context retains full results from the last four model interactions with tools; older results are replaced with brief summaries. Unchanged repeated reads are suppressed while the original result remains in the context window; once it is compressed, the file can be read again. The stable system prompt does not contain the dynamic plan or project map. Actual server-side prompt caching depends on the provider and request parameters.

## Checkpoints, telemetry, and long contexts

A separate temporary Git repository is created outside the project for the current task. It stores the initial state and intermediate text-file changes without modifying the project's `.git`. After the task finishes, its changes can be rolled back to the initial state. Rollback is rejected if text files changed after the task finished; changes made manually *during* the task cannot be automatically distinguished from the agent's changes.

Binary files, symbolic links, `.env*`, `config.local.json`, and the `.git`, `node_modules`, `dist`, `build`, `.next`, and `coverage` directories are excluded from snapshots and rollback. Temporary data contains copies of source code and is removed when the next task starts; it may remain in the system temporary directory after a crash. The current task's checkpoint and rollback do not persist across server restarts.

Changes are checked automatically: JavaScript with `node --check`, JSON by parsing, and TypeScript with local `tsc --noEmit` when both `tsconfig.json` and the compiler are available. Otherwise, the reason for skipping the check is reported. Events are delivered over SSE; token statistics depend on the provider including `usage` in its responses. The context-compaction threshold is approximate, based on character count, and does not guarantee that a request fits a particular model's context window. A root-level `DIABOLIX.md` or `.diabolixrules` file is read at the start of a task, up to 4 KB.
