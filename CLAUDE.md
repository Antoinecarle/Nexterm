# Nexterm -- Development Context for Claude Code

## What is this?

**Nexterm** is a self-hosted VPS management dashboard. It provides a complete web interface (dashboard, terminal, file explorer, monitoring, Docker management, and project management) accessible from any desktop or mobile browser.

---

## Tech Stack

| Layer | Technologies |
|-------|-------------|
| Backend | Node.js, Express, Socket.IO, node-pty, better-sqlite3 |
| Frontend | React 18, Vite, React Router, xterm.js, CodeMirror 6 |
| Auth | JWT (24h expiry), bcryptjs |
| DB | SQLite (terminal sessions) via better-sqlite3 |
| SSL | Self-signed certificate (directory `ssl/`) |
| PWA | manifest.json, service worker, icons |
| Style | Custom CSS, dark theme, responsive mobile-first |

---

## Features

| Page | Route | Description |
|------|-------|-------------|
| Login | `/login` | Email/password authentication |
| Dashboard | `/` | System overview: CPU, RAM, disk, Docker, quick access links |
| Files | `/files` | File explorer with CodeMirror editor (tabs, syntax highlighting, save). Mobile: toggle list/editor |
| Terminal | `/terminal` | Multi-tab web terminal (PTY via node-pty + xterm.js over WebSocket). Rename, project sessions, search, voice commands, mobile control bar |
| Projects | `/projects` | Project management: create, import (git clone with SSE progress), delete, linked terminal sessions |
| System | `/system` | Real-time system monitoring (5s refresh), top processes |
| Docker | `/docker` | Container management (start/stop/restart/pause/remove/logs), image list |

### Mobile

- Bottom navigation bar replaces sidebar
- Adaptive layouts (2-col to 1-col grids, 44px touch targets)
- Terminal: touch control bar (arrows, Enter, Tab, Esc, Ctrl+C, Ctrl+D, Mic)
- Files: toggle mode with fullscreen editor
- PWA installable (manifest + service worker)
- Voice commands via Web Speech API (requires HTTPS)

---

## Project Structure

```
nexterm/
├── CLAUDE.md                     # This file -- context for Claude Code
├── .env                          # EMAIL, PASSWORD_HASH, JWT_SECRET, PORT, SSL_PORT
├── .env.example                  # Template for environment variables
├── .gitignore
├── package.json                  # Backend dependencies
├── LICENSE
│
├── ssl/                          # Self-signed HTTPS certificate (key + cert PEM)
├── data/                         # SQLite database (terminal sessions)
│
├── server/
│   ├── index.js                  # Entry point: Express + HTTPS + Socket.IO + HTTP redirect
│   ├── auth.js                   # POST /api/auth/login + verifyToken middleware
│   ├── db.js                     # SQLite: sessions table (id, name, project, cwd, shell)
│   ├── terminal.js               # WebSocket /terminal: node-pty, multi-sessions, attach/detach
│   └── routes/
│       ├── system.js             # GET /api/system/info, GET /api/system/processes
│       ├── files.js              # CRUD file operations
│       ├── docker.js             # Docker container and image management
│       ├── terminal.js           # Terminal session CRUD
│       └── projects.js           # Project CRUD + git clone via SSE
│
├── client/
│   ├── index.html
│   ├── package.json              # Frontend dependencies
│   ├── vite.config.js            # Dev proxy to backend
│   ├── dist/                     # Vite production build
│   ├── public/                   # PWA assets (manifest, service worker, icons)
│   └── src/
│       ├── main.jsx
│       ├── App.jsx               # React Router (ProtectedRoute + Layout)
│       ├── api.js                # Fetch wrapper with JWT
│       ├── pages/                # All page components
│       ├── components/           # Reusable components
│       └── styles/
│           └── global.css        # Dark theme + responsive (768px, 480px breakpoints)
│
└── screenshots/                  # README screenshots
```

---

## API Routes

### Auth
| Method | Route | Description |
|--------|-------|-------------|
| POST | `/api/auth/login` | Login (email + password) -> JWT |

### System (JWT-protected)
| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/system/info` | CPU, RAM, disk, uptime, OS |
| GET | `/api/system/processes` | Top processes |

### Files
| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/files/list?path=` | List directory |
| GET | `/api/files/read?path=` | Read file (max 2MB) |
| POST | `/api/files/write` | Write file `{path, content}` |
| POST | `/api/files/mkdir` | Create directory `{path}` |
| DELETE | `/api/files?path=` | Delete file/directory |

### Docker
| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/docker/containers` | List containers |
| GET | `/api/docker/images` | List images |
| POST | `/api/docker/containers/:id/:action` | Action (start/stop/restart/pause/unpause/remove) |
| GET | `/api/docker/containers/:id/logs` | Container logs |

### Terminal
| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/terminal/sessions` | List sessions |
| POST | `/api/terminal/sessions` | Create session `{name?, project?, cols, rows}` |
| PATCH | `/api/terminal/sessions/:id` | Rename `{name}` |
| DELETE | `/api/terminal/sessions/:id` | Delete session |

### Projects
| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/projects` | List projects with metadata |
| POST | `/api/projects` | Create project `{name}` |
| POST | `/api/projects/import` | Git clone via SSE `{url, name?}` |
| DELETE | `/api/projects/:name` | Delete project |

### WebSocket
| Namespace | Events |
|-----------|--------|
| `/terminal` | `create-session`, `attach-session`, `kill-session`, `rename-session`, `list-sessions`, `input`, `resize`, `output`, `session-exited` |

---

## Development Commands

```bash
# Start the server (HTTPS + HTTP redirect)
npm start

# Rebuild frontend after changes
npm run build

# Install all dependencies (backend + frontend)
npm run install-all

# Frontend dev server with hot-reload
cd client && npm run dev
```

---

## Security

- Passwords hashed with bcrypt (never stored in plain text)
- JWT with 24h expiration
- `.env`, `ssl/`, `data/` in .gitignore
- All API routes protected by verifyToken middleware (except login)
- WebSocket requires valid JWT
- File reads limited to 2MB
- HTTPS with self-signed certificate
- Project names validated by regex `[a-zA-Z0-9_-]+`

---

## Conventions

- Working directory: project root
- Always use Docker when relevant for service isolation
- Never store secrets in plain text -- use `.env`
- After frontend changes, always rebuild: `cd client && npm run build`
- Express serves `client/dist/` with SPA fallback
- CSS responsive breakpoints: 768px (mobile), 480px (small phone)
- Service worker caches app shell, network-first for assets, ignores API/WebSocket

---

# Development Rules

## MCP Usage

- When working with **Supabase** (database, auth, storage, edge functions, migrations, tables, RLS, etc.), always use the **Supabase MCP server** tools for direct interaction.
- When working with **Railway** (deployment, services, environments, variables, logs, etc.), always use the **Railway MCP server** tools for direct interaction.
- Prefer MCP tools over manual CLI commands or API calls when available.

---

## Frontend Design -- Gemini MCP Workflow

**Rule: Never write frontend/UI code directly.** Use the Gemini MCP Design server for all visual work.

### When to use Gemini (ALWAYS for):
- Creating pages (dashboard, landing, settings, etc.)
- Creating visual components (card, modal, sidebar, form, button, etc.)
- Modifying the design of existing elements
- Anything related to styling/layout

### Exceptions (can do directly):
- Modifying text/copy
- Adding JS logic without UI changes
- Non-visual bug fixes
- Data wiring (useQuery, useMutation, etc.)

### Workflow

1. **New project (no existing design):**
   - `generate_vibes` -> show options to user
   - User picks a vibe
   - `create_frontend` with chosen vibe + `generateDesignSystem: true`
   - Save returned code to target file AND save `designSystem` to `design-system.md`

2. **Subsequent pages/components:**
   - Use `create_frontend` / `modify_frontend` / `snippet_frontend` with `projectRoot`
   - The `design-system.md` is auto-loaded for consistent styling

3. **Existing project with its own design:**
   - Pass CSS/theme files in the `context` parameter

### Design System

For the first page of a new project, set `generateDesignSystem: true`. Gemini returns both code and a complete design system (colors, typography, spacing, buttons, inputs, cards). Save to `design-system.md` at project root. All subsequent calls use `projectRoot` to auto-load it.

---

## ChatGPT Integration Rules

**Model: Always use `gpt-5-mini-2025-08-07`. Non-negotiable.**

### Response Format

ChatGPT returns a **structured response object**, not a plain string:

```json
{
  "id": "response_abc123",
  "object": "response",
  "created": 1730000000,
  "model": "gpt-5-mini-2025-08-07",
  "output": [
    {
      "type": "message",
      "role": "assistant",
      "content": [
        {
          "type": "output_text",
          "text": "Response content"
        }
      ]
    }
  ],
  "usage": {
    "input_tokens": 120,
    "output_tokens": 340
  }
}
```

### Conversation Memory

ChatGPT has **no persistent memory** between API calls. Memory must be implemented via:
- Sending conversation history in each request
- External memory storage (database)

### Recommended Architecture

```
Client (Web / App)
      |
Backend API
      |
Conversation DB
      |
Vector DB (embeddings)
      |
ChatGPT API (gpt-5-mini-2025-08-07)
```

### Data Model

**Conversations table:** `conversation_id`, `user_id`, `created_at`, `updated_at`, `metadata`

**Messages table:** `message_id`, `conversation_id`, `role`, `content_raw`, `content_structured`, `tokens`, `created_at`

### Best Practices

- Store both raw text and structured content
- Calculate and save token counts
- Version system prompts
- Use hybrid memory: short-term (last N messages) + long-term summary + semantic retrieval
- Auto-summarize on session end, topic change, or token threshold
- Never send entire conversation history raw -- use smart selection
- Separate business logic from AI prompts
