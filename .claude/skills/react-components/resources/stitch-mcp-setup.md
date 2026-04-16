# Stitch MCP — Universal Agent Configuration

Google Stitch is a remote MCP server for AI-driven design generation. This file shows how to configure it across all major AI coding tools.

**Server URL:** `https://stitch.googleapis.com/mcp`  
**Auth:** API key via `X-Goog-Api-Key` header  
**Env var:** `GOOGLE_STITCH_API_KEY` (set in your shell profile or `.env`)

---

## OpenCode

**File:** `.opencode/opencode.jsonc` (project root)

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "stitch": {
      "type": "remote",
      "url": "https://stitch.googleapis.com/mcp",
      "headers": {
        "X-Goog-Api-Key": "{env:GOOGLE_STITCH_API_KEY}"
      }
    }
  }
}
```

---

## Claude Code

**File:** `.mcp.json` (project root, project scope — shared with team)

```json
{
  "mcpServers": {
    "stitch": {
      "type": "http",
      "url": "https://stitch.googleapis.com/mcp",
      "headers": {
        "X-Goog-Api-Key": "${GOOGLE_STITCH_API_KEY}"
      }
    }
  }
}
```

Or via CLI:

```bash
claude mcp add --transport http --scope project stitch https://stitch.googleapis.com/mcp \
  --header "X-Goog-Api-Key: $GOOGLE_STITCH_API_KEY"
```

---

## VS Code (GitHub Copilot)

**File:** `.vscode/mcp.json` (project root)

```json
{
  "inputs": [
    {
      "type": "promptString",
      "id": "stitch-api-key",
      "description": "Google Stitch API Key",
      "password": true
    }
  ],
  "servers": {
    "stitch": {
      "type": "http",
      "url": "https://stitch.googleapis.com/mcp",
      "headers": {
        "X-Goog-Api-Key": "${input:stitch-api-key}"
      }
    }
  }
}
```

> VS Code uses `${input:...}` for secrets, which prompts once and stores securely. Alternatively, set the env var and use `"X-Goog-Api-Key": "${env:GOOGLE_STITCH_API_KEY}"`.

---

## Cursor

**File:** `.cursor/mcp.json` (project root)

```json
{
  "mcpServers": {
    "stitch": {
      "type": "streamableHttp",
      "url": "https://stitch.googleapis.com/mcp",
      "headers": {
        "X-Goog-Api-Key": "${GOOGLE_STITCH_API_KEY}"
      }
    }
  }
}
```

> Cursor uses `streamableHttp` for remote HTTP servers. Env vars are referenced as `${VAR_NAME}`.

---

## Codex (OpenAI CLI)

**File:** `~/.codex/config.toml` (global) or via `--config` flag

Codex currently supports only **stdio** transport (local servers). For remote MCP servers like Stitch, use a local proxy:

```bash
# Install mcp-remote to bridge remote MCP servers to stdio
npm install -g mcp-remote

# Option 1: Global config (~/.codex/config.toml)
cat >> ~/.codex/config.toml << 'EOF'
[mcp_servers.stitch]
command = "npx"
args = ["-y", "mcp-remote", "https://stitch.googleapis.com/mcp", "--header", "X-Goog-Api-Key: ${GOOGLE_STITCH_API_KEY}"]
EOF

# Option 2: Per-session via CLI flag
codex --config 'mcp_servers.stitch={command="npx",args=["-y","mcp-remote","https://stitch.googleapis.com/mcp","--header","X-Goog-Api-Key: '"$GOOGLE_STITCH_API_KEY"'"]}'
```

---

## Quick Reference

| Tool        | Config file               | Transport type     | Env var syntax               |
| ----------- | ------------------------- | ------------------ | ---------------------------- |
| OpenCode    | `.opencode/opencode.jsonc`| `remote`           | `{env:VAR}`                  |
| Claude Code | `.mcp.json`               | `http`             | `${VAR}`                     |
| VS Code     | `.vscode/mcp.json`        | `http`             | `${input:id}` or `${env:VAR}`|
| Cursor      | `.cursor/mcp.json`        | `streamableHttp`   | `${VAR}`                     |
| Codex       | `~/.codex/config.toml`    | stdio (via proxy)  | Shell `$VAR` expansion       |
