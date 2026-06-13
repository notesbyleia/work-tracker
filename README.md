# Work Tracker

Plan work by portfolio, workstream, and task. A static web app for tracking delegated inputs, chase dates, and daily planning — built for people whose work depends on other people delivering on time.

## Features

- **Portfolios & workstreams** — organise tasks into portfolios and workstreams with deadlines and effort estimates
- **Priority queue** — auto-ranked view of what needs attention first
- **Dashboard** — Kanban-style lanes for "Waiting" and "With me" tasks, with drag-and-drop between them
- **People view** — see who owes you inputs and how often you've chased them
- **Calendar view** — month-grid view of upcoming task deadlines
- **Risk indicators** — tasks and workstreams flagged by urgency (high / medium)
- **Cloud sync** — optional Supabase-backed sign-in to sync data across devices
- **CSV import/export** — download your data or upload from a file

## Run locally

```bash
python3 -m http.server 8000 --bind 127.0.0.1
```

Open <http://127.0.0.1:8000>.

## Deploy on GitHub Pages

This app is static, so GitHub Pages can serve it directly from the root of the `main` branch.

1. Push this repository to GitHub.
2. In GitHub, open **Settings > Pages**.
3. Under **Build and deployment**, choose **Deploy from a branch**.
4. Set branch to `main` and folder to `/root`.
5. Save.

The site will be available at:

```text
https://<username>.github.io/<repo-name>/
```
