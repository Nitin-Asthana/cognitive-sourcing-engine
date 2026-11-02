# Cognitive Sourcing Engine

*Intent-to-query discovery with a hybrid rule-based + GPT engine.*

Full-stack demo that reimagines B2B textile sourcing as a fast, intelligent
discovery experience. It turns natural-language queries into structured,
filtered product results — with an optional GPT-powered conversational
assistant layered on top.

---

## 📑 Table of Contents

- [Business Case](#-business-case)
- [Architecture](#-architecture)
- [Core Functionality](#️-core-functionality)
- [API Reference](#-api-reference)
- [Search Intelligence](#-search-intelligence)
- [Frontend Experience](#-frontend-experience)
- [Data Model](#-data-model)
- [Engineering & Operational Details](#-engineering--operational-details)
- [Security](#-security)
- [Quickstart](#-quickstart)
- [Optional: GPT via Azure OpenAI](#️-optional-enable-gpt-azure-openai)
- [Tech Stack](#-tech-stack)
- [Project Structure](#-project-structure)

---

## Business Case

Sourcing and procurement teams lose time translating what they need into rigid
catalog filters and SKU codes. The Cognitive Sourcing Engine lets them describe
requirements in plain language and instantly get matching products, a clear
breakdown of how the request was interpreted, compatible component suggestions,
and a grounded assistant to compare options — turning manual catalog work into
a conversation.

---

## 🏗 Architecture

```
┌──────────────────────────┐        HTTP / SSE        ┌───────────────────────────┐
│  Next.js 14 (App Router)  │ ◄──── /search /chat ───► │  FastAPI backend          │
│  React 18 + Tailwind CSS  │       /catalog           │  ├─ Intent extraction     │
│  Single-page dashboard    │       /compatibility     │  ├─ Filter engine         │
└──────────────────────────┘                          │  └─ Catalog store (JSON)  │
                                                       └─────────────┬─────────────┘
                                                                     │ optional
                                                       ┌─────────────▼─────────────┐
                                                       │  Azure OpenAI (GPT)        │
                                                       │  (Entra ID auth, no keys)  │
                                                       └───────────────────────────┘
```

**Two-engine design:**

| Mode | Trigger | Intent extraction | Summaries & chat |
|------|---------|-------------------|------------------|
| **Rule-based** (default) | `MODE=fallback` | Regex/keyword parser | Deterministic templated text |
| **AI** (optional) | `MODE=live` + endpoint | GPT structured JSON | GPT natural language |

When in AI mode, the backend still applies **regex overrides** for exact values
(prices, stretch %) so hard numbers in the query are never misinterpreted, and
it **falls back to rule-based** automatically if the LLM call fails.

---

## ⚙️ Core Functionality

### 1. Natural-language search
Converts a free-text query into a structured intent object, applies it as
filters over the catalog, and returns matching products plus a summary and the
engine used.

### 2. Intent extraction & transparency
Every search surfaces the parsed intent (e.g. `category: Denim`, `max_price: 9`,
`sustainable: true`) as chips in the UI, so users see exactly how their query
was understood.

### 3. Faceted filter engine
Supports filtering by category, GSM weight range, stretch %, weave, color, tags,
certifications, price range, stock status, stock quantity, and sustainability
score — composably in a single query.

### 4. Conversational assistant (chat)
A catalog-grounded assistant that compares products, recommends alternatives,
explains certifications, and advises on construction — strictly limited to
catalog data. Available as both a standard request and a **streaming (SSE)**
endpoint for a real-time typing effect.

### 5. Compatibility analysis
For any fabric, returns compatible linings and stitching threads, plus an
optional AI expert pairing recommendation based on GSM, weave, and end-use.

### 6. Full catalog browsing
Loads and displays the entire catalog on startup, with quick-filter pills for
common queries (All Denim, Sustainable, Heavy Weight, Flame Resistant, etc.).

---

## 🔌 API Reference

Base URL is configured via `NEXT_PUBLIC_API_URL` (frontend) / `HOST`+`PORT`
(backend). All responses are JSON unless noted.

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/` | Service metadata, version, and active engine |
| `GET` | `/search?q=<query>` | NL search → intent, results, summary, engine |
| `POST` | `/chat` | Conversational assistant (full reply + product IDs) |
| `GET` | `/chat/stream?message=&history=` | Streaming chat via Server-Sent Events |
| `GET` | `/compatibility/{product_id}` | Linings, threads, and AI pairing advice |
| `GET` | `/catalog` | Full catalog (used for initial load) |

Interactive OpenAPI docs are auto-generated at `/docs`.

### Response models

- **SearchResponse** — `query`, `intent`, `ai_summary`, `result_count`, `results`, `engine`
- **ChatResponse** — `reply`, `suggested_products` (catalog IDs mentioned)
- **CompatibilityResponse** — `product_id`, `linings`, `threads`, `ai_recommendation`

---

## 🧠 Search Intelligence

The rule-based parser understands a wide range of sourcing language, including:

| User phrasing | Extracted intent |
|---------------|------------------|
| "heavy", "heavyweight", "rugged" | `gsm_min: 350` |
| "light", "sheer", "lightweight" | `gsm_max: 150` |
| "220 gsm", "above 300 gsm" | GSM range or threshold |
| "sustainable", "eco", "organic", "BCI", "GRS" | `sustainable: true` |
| "sustainability > 45" | `min_sustainability_score: 45` |
| "stretch", "elastic", "spandex" | `has_stretch: true` |
| "stretch > 5%" | `min_stretch: 5` |
| "under $9", "below $10", "cheaper than $7" | `max_price` |
| "premium", "luxury", "above $10" | `min_price` |
| "in stock more than 45", "at least 20000 meters" | `min_stock_quantity` + `In Stock` |
| "flame resistant", "FR", "PPE", "arc flash" | `category: Advanced Materials` + `tag: FR` |
| "chemical resistant" / "anti-static / ESD" | corresponding Advanced Materials tag |
| colors, weaves, certifications (NFPA, ASTM…) | mapped to the matching field |

If no filters match or no products are found, it falls back to a full-text
search across name, description, tags, and category.

---

## 🖥 Frontend Experience

A single-page dashboard (dark theme) built with the Next.js App Router:

- **Command bar** — type-to-search with live clearing and quick-filter pills.
- **AI summary panel** — shows the generated summary and which engine answered.
- **Intent chips** — visualizes the parsed query parameters.
- **Fabric cards** — responsive grid showing specs, certification badges, stock,
  pricing, lead time, MOQ, and an animated **sustainability score ring**.
- **Compatibility drawer** — slide-in panel with matching linings (clickable to
  drill in), stitching threads, AI recommendation, and quick specs; supports
  back-navigation through drilled selections.
- **AI chat panel** — markdown-rendered conversation (via `react-markdown` +
  `remark-gfm`) with suggested-product chips that trigger searches, plus
  animated typing indicators.

---

## 🗃 Data Model

The catalog is a JSON array of fabric products spanning three categories —
Denim, Wovens, and Advanced Materials.

Each product includes: `id`, `name`, `category`, `subcategory`, `description`,
`gsm`, `weave`, `stretch`, `composition`, `width_cm`, `finish`, `color`,
`certifications[]`, `price_tier`, `price_value`, `lead_time_weeks`,
`moq_meters`, `stock_status`, `stock_quantity_meters`, `sustainability_score`,
`compatible_linings[]`, `compatible_threads[]`, and `tags[]`.

At load time the backend derives `price_low`/`price_high` from each
`price_tier` range for accurate price filtering.

> The catalog is **sample/demo data** for illustration only.

---

## Engineering & Operational Details

Technical behaviors worth calling out:

- **Hybrid engine with automatic fallback** — AI mode (GPT) is tried first;
  any LLM failure transparently drops to the deterministic rule-based engine, so
  the API never hard-fails on the model.
- **Deterministic regex overrides** — even in AI mode, exact numeric constraints
  (prices like `under $9`, `stretch > 5%`) are re-extracted with regex and
  override the LLM output, guaranteeing hard numbers are honored.
- **Full-text fallback** — when no structured filters match, the engine runs a
  substring search across name, description, tags, category, and subcategory.
- **Grounded chat with history window** — the assistant is constrained to the
  catalog via a system prompt and carries the **last 10 messages** for context;
  it extracts and returns any catalog product IDs mentioned in a reply.
- **Streaming via Server-Sent Events** — `/chat/stream` emits token-by-token
  events for a real-time typing effect.
- **Performance instrumentation** — per-stage timings (intent extraction,
  summary generation, total search) are logged for each request.
- **Auto-generated API docs** — Swagger UI at `/docs` and ReDoc at `/redoc`
  (FastAPI built-in).
- **Env-driven config with safe defaults** — `MODE`, `HOST`/`PORT`,
  `NEXT_PUBLIC_API_URL`; the backend binds to `127.0.0.1` by default and reads
  all addresses from the environment (no hardcoded URLs).
- **CORS enabled** for cross-origin frontend calls.
- **Windows-safe startup** — uvicorn signal handlers are patched to avoid
  Windows event-loop issues.
- **Credential-free by default** — runs fully offline; Azure OpenAI is strictly
  opt-in via Entra ID (no API keys).

---

## 🔒 Security

- **No API keys, secrets, passwords, or connection strings** are stored anywhere
  in this repository.
- The optional Azure OpenAI integration authenticates with **Entra ID**
  (`DefaultAzureCredential`) — tokens are fetched at runtime from your local
  Azure sign-in and are never written to disk or committed.
- No hardcoded API/run URLs in source code — the backend binds to `127.0.0.1`
  by default and both apps read their addresses from environment variables.
- Real configuration lives in local `.env` files, which are git-ignored. Use the
  provided `.env.example` templates as a starting point.

---

## 🚀 Quickstart

Runs with **zero credentials**.

### Backend

```bash
cd backend
python -m venv .venv
# Windows:  .venv\Scripts\activate
# macOS/Linux:  source .venv/bin/activate
pip install -r requirements.txt
python main.py
```

The API runs locally (default port `8000`); interactive OpenAPI docs are served
at the `/docs` path.

### Frontend

```bash
cd frontend
cp .env.example .env.local   # sets NEXT_PUBLIC_API_URL to your backend
npm install
npm run dev
```

The app runs locally on the default Next.js port (`3000`).

---

## ⚙️ Optional: enable GPT (Azure OpenAI)

The app works great without this. To enable the LLM engine:

1. `cd backend && cp .env.example .env`
2. Set `MODE=live` and add your `AZURE_OPENAI_ENDPOINT` in the `.env` file.
3. Sign in to Azure locally (`az login`) with access to the resource.
4. Restart the backend.

No key is required — authentication is handled via Entra ID.

---

## 🧰 Tech Stack

**Backend:** Python, FastAPI, Uvicorn, Pydantic, python-dotenv, (optional)
openai + azure-identity.

**Frontend:** Next.js 14 (App Router), React 18, TypeScript, Tailwind CSS,
react-markdown, remark-gfm.

---

## 📁 Project Structure

```
backend/
  main.py            FastAPI app: endpoints, intent extraction, filter engine
  requirements.txt   Python dependencies
  .env.example       Backend config template (MODE, HOST/PORT, optional Azure)
  lib/catalog.json   Sample fabric catalog (30 SKUs)
frontend/
  app/
    page.tsx         Main dashboard (search, cards, drawer, chat)
    layout.tsx       Root layout & metadata
    globals.css      Tailwind base + custom styles
  package.json       Node dependencies & scripts
  next.config.js     Next.js config
  tailwind.config.ts Theme & design tokens
  tsconfig.json      TypeScript config
  .env.example       Frontend config template (NEXT_PUBLIC_API_URL)
.gitignore
README.md
```
