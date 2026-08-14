# Zhiliao (知了)

[![CI](https://github.com/B-tech-hub/zhiliao/actions/workflows/ci.yml/badge.svg)](https://github.com/B-tech-hub/zhiliao/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/B-tech-hub/zhiliao)](https://github.com/B-tech-hub/zhiliao/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Self-hosted, AI-organized personal knowledge base — jot a note, and an LLM titles it, tags it, summarizes it, and files it into the right topic. Low-confidence notes land in an inbox; once enough pile up, the AI suggests new topics via clustering.

Single-user by design. Next.js 15 + SQLite, PWA-ready, works with any OpenAI-compatible API.

Full documentation is in Simplified Chinese — see [README.md](README.md). This page covers just enough to get you running.

![Demo: jot a note → AI files it → topic suggestions](docs/screenshots/demo.gif)

## Features

- Markdown notes (TipTap WYSIWYG), paste/drag image upload, debounced autosave
- AI pipeline: one call per note → topic + title + tags + summary, with retry/backoff; fields you edit manually are never overwritten
- Topic suggestions: AI clusters inbox notes and proposes new topics
- Chinese full-text search (jieba segmentation + SQLite FTS5)
- AI chat scoped to a note or a topic (SSE streaming, optional vision model)
- Your data stays yours: one-click zip export (Markdown + images, Obsidian-friendly), manual backup button, and a trash bin — deleted notes are recoverable for 30 days
- PWA, dark mode, daily backups (database + images, 7 copies each)

## Try it in 1 minute (no API key)

```bash
git clone https://github.com/B-tech-hub/zhiliao.git
cd zhiliao && npm install
npm run demo
```

Open http://localhost:3000, password `demo`. Demo data and a local mock LLM are bundled — nothing leaves your machine. Delete `./data-demo/` to reset.

Prefer Docker? Download [docker-compose.demo.yml](docker-compose.demo.yml), then:

```bash
docker compose -f docker-compose.demo.yml up -d   # → http://localhost:3210
```

## Deploy with Docker

Prebuilt images (amd64 / arm64) are published to `ghcr.io/b-tech-hub/zhiliao`:

```bash
curl -LO https://raw.githubusercontent.com/B-tech-hub/zhiliao/main/docker-compose.yml
curl -Lo .env https://raw.githubusercontent.com/B-tech-hub/zhiliao/main/.env.example
# edit .env (APP_PASSWORD, SESSION_SECRET), then:
docker compose up -d
```

> ⚠️ Zhiliao needs a long-running process (in-process AI job queue + backup timers) — it cannot run on Vercel or other serverless platforms.
>
> On Windows Docker Desktop, add the named-volume override: `docker compose -f docker-compose.yml -f docker-compose.win.yml up -d` (bind mounts don't support SQLite WAL).

## Minimal configuration

| Variable | Required | Notes |
|---|---|---|
| `APP_PASSWORD` | ✅ | login password |
| `SESSION_SECRET` | ✅ | ≥32 random chars (`openssl rand -hex 32`) |
| `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL` | | any OpenAI-compatible endpoint (DeepSeek, Qwen, Claude, …); can also be set later in the Settings UI |

The app works without an LLM configured — notes stay "pending" and are processed automatically once you add one.

## Contributing & security

See [CONTRIBUTING.md](CONTRIBUTING.md) (Chinese). Report vulnerabilities privately via GitHub Security Advisories — see [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE)
