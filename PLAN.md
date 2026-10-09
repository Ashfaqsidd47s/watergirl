# Water Girl — Plan

> Your personal "Friday": one app where you talk to Water Girl, she starts coding
> agents (Claude Code today, others later) on any of your repos, keeps track of
> what every agent is doing, pings you when one is stuck or done, and helps you
> merge the results. Works from your phone, no laptop needed.

---

## 1. The problem in one line

Today each Claude Code session lives on its own, sees one repo/account at a time,
and you have to go and look at it. You want **one place** that knows *every*
project, *every* running agent, and talks back to you like a junior dev giving
standup updates.

---

## 2. How it works (the big picture)

```
 You (phone / web / voice / Telegram)
            │  "Start nucleus, build order management, open a PR"
            ▼
 ┌──────────────────────────┐
 │  Water Girl BRAIN        │  ← chat assistant + task board + memory
 │  (API + database)        │     turns your words into tasks,
 │                          │     answers "what's the status of X?"
 └──────────┬───────────────┘
            │ hands out tasks, receives live updates
            ▼
 ┌──────────────────────────┐
 │  WORKER (your PC or a    │  ← runs Claude Code headless
 │  cheap always-on server) │     one git worktree per task
 │                          │     many tasks in parallel
 └──────────┬───────────────┘
            │ clone / push / open PR (right account per repo)
            ▼
        GitHub (all your accounts & orgs)
```

Three pieces:

| Piece | What it does | Lives where |
|---|---|---|
| **App** | Chat with Water Girl, see the board, get notifications, tap "merge" | Phone app (iOS + Android, Expo) |
| **Brain** | Stores projects/repos/tasks, talks to you, summarises progress | Small server (VPS) |
| **Worker** | Actually runs `claude` in a worktree per task, streams progress back | Your home PC *or* a VPS (always on) |

---

## 3. Your requirements → how we solve each

### 3.1 "Many repos, many GitHub accounts, without logging out/in"
- Water Girl stores **one credential per GitHub account** (best: install a
  **GitHub App** on each account/org; simpler: a fine-grained token per account).
- Every repo in Water Girl is linked to the account that owns it.
- When a task starts, the worker clones that repo **with that account's
  credential only**. No global login, nothing to switch.
- Claude itself never needs to know about accounts — it just sees a folder
  that is already a git checkout with push rights.

### 3.2 "Many agents on the same project at the same time" (worktrees)
- Each repo gets **one main clone** on the worker.
- Each task gets its **own `git worktree` + its own branch**
  (e.g. `wg/nucleus/order-management`). Separate folder, same repo, no clashes.
- Task finished → branch pushed → PR opened → worktree deleted. Clean.
- So: nucleus/order-management and nucleus/payments can run side by side,
  plus another repo at the same time.

### 3.3 "Feedback / she tells me back"
This is the part Claude Code alone doesn't give you. We get it three ways:
1. **Live stream** — the worker runs Claude with
   `--output-format stream-json`, so every step (files edited, tests run,
   errors) flows into the Brain in real time.
2. **A Water Girl tool inside every agent** (a small MCP server) with tools
   like `report_progress("tests passing, starting UI")` and
   `ask_human("Should orders support partial refunds?")`.
   When an agent calls `ask_human`, the task goes **🟡 Needs you**, your phone
   buzzes, you answer in chat, the worker **resumes the same session**
   (`claude --resume <id>`) with your answer.
3. **Hooks** — Claude Code's `Stop` / `Notification` hooks post "done" /
   "waiting" events even if the agent forgets to report.

### 3.4 "Talk to it like my juniors" (simple UI)
- Board grouped by **Project → Repo → Task** with plain statuses:
  `Queued · Working · Needs you · Ready for review · Merged · Failed`.
- Ask in normal words: *"What's going on in nucleus?"* → Water Girl reads the
  task events and answers like a standup:
  *"Order management: API done, 2 tests failing on refunds, waiting for your
  answer on partial refunds. Payments: PR #41 open, CI green."*
- Give advice the same way: *"Tell the order agent to use the existing
  `Money` type"* → sent into that running session.

### 3.5 "Merge it all back in one place"
- Every task ends as a **PR** (never pushes to main directly).
- Water Girl shows: PR link, CI status, conflicts.
- Buttons: **Merge**, **Request changes** (sends your comment back to the
  agent), **Fix conflicts** (spins up a small agent to rebase/resolve).

### 3.6 "From anywhere, without my laptop"
- The worker is **always on** (VPS or home PC), so nothing depends on your laptop.
- App is a **native phone app** (Expo / React Native) with push notifications.

### 3.7 "Claude now, other agents later"
- Worker talks to agents through a small **adapter** interface:
  `start(task) / send(message) / resume(id) / stop()` + event stream.
- Adapter #1: Claude Code CLI. Later: Codex CLI, Gemini CLI, etc.

---

## 4. What's possible vs. not (honest list)

### ✅ Doable
- Multiple repos & multiple GitHub accounts in one place.
- Several agents in parallel, including on the same repo (worktrees).
- Live progress, "needs you" questions, push notifications, resume after answer.
- Standup-style summaries per project.
- PR-based merge flow with conflict-fix agent.
- Phone-first control, laptop off.
- Swapping in other coding agents later.

### ⚠️ Possible but with limits
- **Parallel sessions on a subscription**: your Claude plan has usage limits.
  Realistically 2–5 agents at once; Water Girl should queue the rest.
- **Using Claude's own cloud sessions (claude.ai/code) as the backend**:
  there's no stable public API we should build on today. So v1 runs Claude
  Code on **our own worker**. If an official API appears, we add it as another
  adapter.
- **"Hey Water Girl" always-listening voice**: phones block background mic.
  Use push-to-talk / a Siri or Android shortcut instead.
- **Code quality**: agents can be steered (project rules files, tests, review
  agent), but you still review before merge.

### ❌ Not possible / don't do
- Using your personal subscription to run this **for other people** (that
  needs API keys and per-user billing). For you alone, the official Claude Code
  CLI logged in with your plan is fine.
- Fully unattended "merge to main without me" safely — keep a human tap.

---

## 5. Build phases

### Phase 0 — Decisions ✅
- Front door: **native phone app** (Expo / React Native, iOS + Android), not Telegram/PWA.
- Stack: **TypeScript** everywhere — Expo app · Node/Fastify server (brain + worker in one
  process for now) · SQLite (`node:sqlite`).
- Worker host: any always-on machine (VPS or home PC). Still your call.

### Phase 1 — MVP "she works and reports back" ✅ (built)
- Multiple GitHub accounts (encrypted tokens), projects, repos.
- Create task → worktree + branch → `claude -p` stream → commit leftovers → push → open PR.
- Live timeline in the app, standup summary, push notifications (Expo push or ntfy).
- "Needs you" via a `QUESTION:` line; your reply resumes the **same** Claude session.
- Parallel agents with a queue (`WG_MAX_PARALLEL`), stop, merge (squash + cleanup), archive.
- End-to-end tests with a fake Claude CLI / fake GitHub; app verified in a browser.

### Phase 2 — "She's a real assistant" (next)
- Water Girl MCP (`report_progress`, `ask_human`) so agents can ask mid-run, not only at the end.
- Chat with Water Girl herself ("what's the status of Nucleus?", "start X in Y") — an LLM
  turning your words into tasks and summaries.
- Usage-limit awareness (the CLI already reports rate-limit events) to pace the queue.
- Request-changes from PR review comments; fix-conflicts agent.
- Sandbox each agent (separate OS user or container) so it can't read the server's data.
- One-command deploy (Dockerfile / systemd unit) for a VPS.

### Phase 3 — "Friday mode" (ongoing)
- Voice in/out, daily standup digest.
- Per-project memory & rules (code style, architecture notes) fed to every agent.
- Review agent that checks a PR before it reaches you.
- More agent adapters (Codex, Gemini…).

---

## 6. Data model (first draft)

- **Account** — a GitHub login/app installation + credential.
- **Project** — e.g. "Nucleus"; groups one or more repos.
- **Repo** — owner/name, default branch, linked Account.
- **Task** — title, prompt, repo, branch, status, agent type, session id, PR url.
- **Event** — timestamped stream of what happened in a task (progress, question, error, done).
- **Message** — your chat with Water Girl (and your answers to `ask_human`).

---

## 7. Open questions for you
1. Worker on your home PC or a VPS?
2. ~~First interface~~ — decided: native mobile app.
3. Which Claude plan are you on (affects how many agents in parallel)?
4. Is "Vertical" the umbrella name and "Water Girl" the assistant, or one and the same?
