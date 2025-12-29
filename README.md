# Trello JSON/CSV Import Power-Up

This repo contains a **Trello Power-Up** that adds a **Board button**: **“Import JSON/CSV”**.

When clicked, it opens an import UI with:
- A **drag & drop** file zone (JSON or CSV)
- A **column mapping** step (choose title/list/description columns)
- An **import** step that **adds cards into existing Trello lists** (and can optionally create missing lists)

## What’s implemented

- **Board button** via `board-buttons` capability (`client.js`)
- **Popup UI** (`import.html`) with drag/drop and mapping controls
- **CSV parsing** via PapaParse CDN
- **JSON parsing** for:
  - An array of objects, or
  - An object containing an array under `items`, `data`, `cards`, or `rows`
- **Import logic**:
  - Creates cards with `name` from the selected title column
  - Picks the target Trello list from the selected “list/column” column (optional) or a default list
  - If a list name already exists on the board, cards are added to that list
  - Optionally creates missing lists (checkbox)

## Setup (required)

### 1) Host the Power-Up over HTTPS

Trello Power-Ups must be served over **HTTPS**.

Host the contents of this repo using any static hosting (Netlify/Vercel/GitHub Pages/etc). You must know the final **HTTPS base URL**, for example:
- `https://your-domain.com/trello-import`

#### Hosting with GitHub Pages (recommended)

GitHub Pages hosts your static files at:
- `https://<github-username>.github.io/<repo-name>/`

Steps:
1. Push this folder to a GitHub repository (for example: `trello-json-import`)
2. In GitHub: **Repo → Settings → Pages**
3. Under **Build and deployment**:
   - **Source**: “Deploy from a branch”
   - **Branch**: `main` (or `master`) and **Folder**: `/ (root)`
4. Wait for Pages to publish. You’ll get a URL like:
   - `https://<github-username>.github.io/trello-json-import/`

Important: because Pages adds `/<repo-name>/` to the URL, your Power-Up files must be referenced with that prefix.

### 2) Update `manifest.json`

Edit `manifest.json` and replace:
- `https://YOUR_HTTPS_DOMAIN_HERE/icon.svg`
- `https://YOUR_HTTPS_DOMAIN_HERE/index.html`

with your real hosted URLs.

Example for GitHub Pages (repo name = `trello-json-import`):
- `icon.url`: `https://<github-username>.github.io/trello-json-import/icon.svg`
- `connectors.iframe.url`: `https://<github-username>.github.io/trello-json-import/index.html`

### 3) Create a Power-Up in Trello and point it to your manifest

1. Go to `https://trello.com/power-ups/admin`
2. Create a new Power-Up
3. Set the **manifest URL** to your hosted `manifest.json`, for example:
   - `https://your-domain.com/trello-import/manifest.json`

Example for GitHub Pages:
- `https://<github-username>.github.io/trello-json-import/manifest.json`

### 4) Set your Trello API key

The importer creates cards using the Trello REST API from the Power-Up iframe.

1. Get your Trello API key from `https://trello.com/app-key`
2. Put it into `config.js`:

```js
window.TRELLO_IMPORT_APP_KEY = 'YOUR_TRELLO_API_KEY';
```

> The API key is public. Trello authentication is done via `t.authorize()` which stores a user token in Power-Up private member storage.

## Usage

1. Add the Power-Up to a board
2. Click **Import JSON/CSV** (top of board)
3. Click **Authorize Trello**
4. Drag & drop a `.csv` or `.json`
5. Map columns:
   - **Card title column** (required)
   - **List/column name column** (optional)
   - **Default Trello list** (used if no list column or blank list values)
   - **Description column** (optional)
   - Optional: choose extra columns to append into the card description
6. Click **Import**

## File format expectations

### CSV
- Must include a **header row** (first row = column names).

### JSON
- Must be an **array of objects**, e.g.:
  - `[{ "title": "...", "list": "Todo" }, ...]`
- Or an object containing an array under `items`/`data`/`cards`/`rows`.

## Notes / next improvements

If you want, we can expand this MVP to support:
- Mapping to **labels**, **due date**, **members**, **custom fields**
- “Dry run / preview” table before import
- Deduplication rules (e.g. don’t re-import same card)
- Smarter list matching (case-insensitive is already used; can also support aliases)


