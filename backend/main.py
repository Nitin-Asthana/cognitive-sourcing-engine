"""
Sourcing Architect — B2B Product Discovery Backend
FastAPI server for intelligent fabric search.

Runs out-of-the-box with a built-in rule-based engine (no credentials needed).
Optionally upgrades to Azure OpenAI GPT-4o when MODE=live and an endpoint is
configured. Authentication uses Entra ID (DefaultAzureCredential) — there are
NO API keys or secrets stored in this codebase.
"""

import json
import os
import re
import logging
import time
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

# ─── Load Environment ─────────────────────────────────────────────────────────

load_dotenv()

logger = logging.getLogger("arvind-ai")
logging.basicConfig(level=logging.INFO)

# ─── Optional Azure OpenAI Client (Entra ID auth — NO API keys) ────────────────
# MODE defaults to "fallback" so the app runs with zero credentials.
# Set MODE=live and AZURE_OPENAI_ENDPOINT to enable GPT-4o (uses Entra ID auth).

DEPLOYMENT = os.getenv("AZURE_OPENAI_DEPLOYMENT", "gpt-4o")
MODE = os.getenv("MODE", "fallback")  # "fallback" = rule-based only, "live" = Azure OpenAI

openai_client = None
if MODE == "live" and os.getenv("AZURE_OPENAI_ENDPOINT"):
    try:
        from openai import AzureOpenAI
        from azure.identity import DefaultAzureCredential, get_bearer_token_provider

        credential = DefaultAzureCredential()
        token_provider = get_bearer_token_provider(credential, "https://cognitiveservices.azure.com/.default")

        openai_client = AzureOpenAI(
            azure_endpoint=os.getenv("AZURE_OPENAI_ENDPOINT", ""),
            azure_ad_token_provider=token_provider,
            api_version=os.getenv("AZURE_OPENAI_API_VERSION", "2025-01-01-preview"),
        )
        logger.info("✅ Azure OpenAI client initialized (Entra ID auth)")
    except Exception as e:
        logger.error(f"❌ Azure OpenAI init failed, using rule-based engine: {e}")
else:
    logger.info("ℹ️  Running in rule-based mode (no credentials required)")


# ─── App Setup ────────────────────────────────────────────────────────────────

app = FastAPI(
    title="Sourcing Architect — Fabric Discovery Engine",
    version="2.0.0",
    description="B2B product search over a sample textile catalog, with an optional GPT-4o engine.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── Load Catalog ─────────────────────────────────────────────────────────────

CATALOG_PATH = Path(__file__).parent / "lib" / "catalog.json"

with open(CATALOG_PATH, "r", encoding="utf-8") as f:
    CATALOG: list[dict] = json.load(f)

# Pre-compute price_low and price_high from price_tier range (e.g. "$4.20 - $5.50")
for _p in CATALOG:
    _tier = _p.get("price_tier", "")
    _prices = re.findall(r"\$(\d+(?:\.\d+)?)", _tier)
    if len(_prices) >= 2:
        _p["price_low"] = float(_prices[0])
        _p["price_high"] = float(_prices[1])
    else:
        # Fallback: use price_value for both
        _p["price_low"] = _p["price_value"]
        _p["price_high"] = _p["price_value"]

CATALOG_MAP: dict[str, dict] = {item["id"]: item for item in CATALOG}

# Pre-compute a compact catalog summary for the LLM system prompt
CATALOG_SUMMARY = json.dumps(
    [
        {
            "id": p["id"],
            "name": p["name"],
            "category": p["category"],
            "subcategory": p["subcategory"],
            "gsm": p["gsm"],
            "weave": p["weave"],
            "stretch": p["stretch"],
            "certifications": p["certifications"],
            "price_tier": p["price_tier"],
            "price_low": p["price_low"],
            "price_high": p["price_high"],
            "stock_status": p["stock_status"],
            "stock_quantity_meters": p.get("stock_quantity_meters", 0),
            "sustainability_score": p["sustainability_score"],
            "tags": p["tags"],
            "color": p["color"],
        }
        for p in CATALOG
    ],
    indent=None,
)


# ─── Response Models ──────────────────────────────────────────────────────────


class SearchResponse(BaseModel):
    query: str
    intent: dict
    ai_summary: str
    result_count: int
    results: list[dict]
    engine: str  # "gpt-4o" or "regex-fallback"


class CompatibilityResponse(BaseModel):
    product_id: str
    linings: list[dict]
    threads: list[str]
    ai_recommendation: str


class ChatRequest(BaseModel):
    message: str
    history: list[dict] = []  # [{"role":"user","content":"..."},...]


class ChatResponse(BaseModel):
    reply: str
    suggested_products: list[str]  # product IDs mentioned


# ─── System Prompts ───────────────────────────────────────────────────────────

INTENT_SYSTEM_PROMPT = f"""You are the Arvind AI Fabric Discovery Engine — an expert B2B textile sourcing assistant.

Your job: parse the user's natural-language query and return a STRICT JSON object with filter parameters.

Available filter keys (use ONLY these, omit any that don't apply):
- "category": one of "Denim", "Wovens", "Advanced Materials"
- "gsm_min": integer (minimum GSM weight)
- "gsm_max": integer (maximum GSM weight)
- "sustainable": true (if user wants eco/sustainable/certified fabrics)
- "has_stretch": true (if user wants stretch/elastic fabrics WITHOUT specifying a percentage)
- "min_stretch": integer (minimum stretch percentage — extract from "stretch > 5%", "stretch above 10", "at least 3% stretch". Do NOT also set has_stretch when min_stretch is used.)
- "weave": string (e.g. "3x1 RHT", "Broken Twill", "Plain", "Satin", "Dobby", "Ripstop", "Oxford")
- "stock_status": "In Stock" (only if user specifically wants available/ready items)
- "min_stock_quantity": integer (minimum stock in meters — extract from "more than X", "at least X", "over X" when referring to stock/inventory/quantity)
- "max_stock_quantity": integer (maximum stock in meters — extract from "less than X", "under X" when referring to stock/inventory/quantity)
- "max_price": float (products whose ENTIRE price range is below this — extract from "under $X", "below $X", "less than $X", "cheaper than $X", "budget", "affordable")
- "min_price": float (products whose ENTIRE price range is above this — extract from "above $X", "over $X", "more than $X", "premium", "luxury", "high-end")
- "color": string (e.g. "Black", "Indigo", "Navy", "White", "Blue")
- "tag": string (one of: "formal", "casual", "industrial", "summer", "heritage", "selvedge", "stretch", "premium", "FR", "PPE")
- "certification_keyword": string (e.g. "NFPA", "ASTM", "EN ISO", "OEKO-TEX")
- "min_sustainability_score": integer (minimum sustainability score — extract from "sustainability > X", "sustainability above X", "sustainability score at least X")

RULES:
1. Return ONLY valid JSON. No markdown, no explanation, no backticks.
2. "heavy" means gsm_min >= 350. "light"/"lightweight" means gsm_max <= 150.
3. "sustainable"/"eco"/"organic"/"recycled" WITHOUT a specific number → set "sustainable": true. WITH a number like "sustainability > 45" → set "min_sustainability_score": 45 (do NOT set "sustainable": true when a specific number is given)
4. CRITICAL — "flame resistant"/"FR"/"fire"/"PPE"/"arc flash" → you MUST set BOTH category: "Advanced Materials" AND tag: "FR". Never return just category without the tag for FR queries.
5. "chemical resistant" → category: "Advanced Materials", tag: "chemical-resistant"
6. "anti-static"/"ESD" → category: "Advanced Materials", tag: "anti-static"
7. If the query is very vague or conversational (like "hello"), return {{}}.
8. CRITICAL: When user mentions a dollar amount like "under $5", "below $10", "less than $7", ALWAYS extract the exact number as max_price. "above $10", "over $8" → use as min_price.
9. "cheap"/"budget"/"affordable" without a number → max_price: 8.0. "premium"/"luxury" without a number → min_price: 10.0.
10. ALWAYS use the "tag" field to narrow results when the user's query implies a specific subcategory. Don't just rely on "category" alone.
11. CRITICAL: When user mentions stock/inventory quantity like "in stock more than 45", "stock above 50000", "at least 20000 meters" → extract as min_stock_quantity (in meters). Numbers under 1000 should be multiplied by 1000 (e.g. "more than 45" means 45000 meters). Also set stock_status: "In Stock".
12. When user says "quantity" combined with "more than"/"at least"/"over" + a number → use min_stock_quantity. Combined with "less than"/"under"/"below" → use max_stock_quantity."""

CHAT_SYSTEM_PROMPT = f"""You are **Arvind AI**, a B2B textile sourcing assistant for Arvind Ltd.

IMPORTANT — YOUR ONLY SOURCE OF TRUTH IS THIS PRODUCT CATALOG:
{CATALOG_SUMMARY}

STRICT RULES:
1. You may ONLY reference products, specs, prices, certifications, and data that exist in the catalog above. Nothing else.
2. Do NOT use any outside knowledge about textiles, fabrics, brands, or industry data. If it's not in the catalog, you don't know it.
3. When recommending or comparing products, cite the exact product ID (e.g., ARV-DEN-901) and exact values from the catalog (GSM, price_value, certifications, stock_status, stock_quantity_meters, sustainability_score, etc.).
4. If a user asks about a product, fabric, or brand that is NOT in the catalog, respond: "That is not available in our current Arvind catalog. Here are the closest options we offer:" and then suggest relevant catalog products.
5. If a user asks a general question (e.g., "what is BCI certification?"), answer ONLY in the context of catalog products that have that certification. Do not provide generic industry definitions.
6. Never invent, estimate, or approximate any product ID, price, GSM, certification, stock quantity, or any other spec. Use exact catalog values only.
7. Keep responses concise and data-rich. Use markdown formatting: bullet points for specs, tables for comparisons, bold for product names and IDs.
8. Maintain a professional B2B tone — you are advising procurement managers and sourcing teams.
9. If the catalog does not contain enough information to answer a question, say so clearly. Do not fill gaps with outside knowledge."""

SUMMARY_SYSTEM_PROMPT = """You are a textile search results summarizer. Given a user query and the matching products, write a 1-2 sentence summary that highlights the key findings. Be specific about counts, categories, and notable attributes. Keep it concise and professional. Do NOT use markdown formatting."""

COMPATIBILITY_SYSTEM_PROMPT = """You are an expert textile compatibility advisor for Arvind Ltd. Given a fabric and its compatible linings/threads, provide a brief (2-3 sentences) expert recommendation on why these pairings work well together. Consider GSM compatibility, end-use, stitch requirements, and construction type. Be specific and technical."""


# ─── Azure OpenAI: Intent Extraction ──────────────────────────────────────────


def extract_intent_ai(query: str) -> dict:
    """Use GPT-4o to extract structured intent from a natural-language query."""
    try:
        response = openai_client.chat.completions.create(
            model=DEPLOYMENT,
            messages=[
                {"role": "system", "content": INTENT_SYSTEM_PROMPT},
                {"role": "user", "content": query},
            ],
            temperature=0.1,
            max_tokens=300,
            response_format={"type": "json_object"},
        )
        raw = response.choices[0].message.content.strip()
        intent = json.loads(raw)
        logger.info(f"[GPT-4o Intent] query='{query}' → {intent}")
        return intent
    except Exception as e:
        logger.warning(f"[GPT-4o Intent FAILED] {e} — falling back to regex")
        return extract_intent_regex(query)


def generate_summary(query: str, results: list[dict]) -> str:
    """Use GPT-4o to generate a natural-language summary of search results."""
    try:
        products_brief = [
            {"name": p["name"], "id": p["id"], "category": p["category"], "gsm": p["gsm"]}
            for p in results[:10]
        ]
        response = openai_client.chat.completions.create(
            model=DEPLOYMENT,
            messages=[
                {"role": "system", "content": SUMMARY_SYSTEM_PROMPT},
                {
                    "role": "user",
                    "content": f'Query: "{query}"\nMatching products ({len(results)} total): {json.dumps(products_brief)}',
                },
            ],
            temperature=0.3,
            max_tokens=150,
        )
        return response.choices[0].message.content.strip()
    except Exception as e:
        logger.warning(f"[GPT-4o Summary FAILED] {e}")
        return f"Found {len(results)} matching fabrics for \"{query}\"."


def generate_compatibility_advice(product: dict, linings: list[dict], threads: list[str]) -> str:
    """Use GPT-4o to generate expert compatibility advice."""
    try:
        context = {
            "fabric": {"name": product["name"], "id": product["id"], "gsm": product["gsm"], "weave": product["weave"], "composition": product["composition"]},
            "linings": [{"name": l["name"], "gsm": l["gsm"], "weave": l["weave"]} for l in linings],
            "threads": threads,
        }
        response = openai_client.chat.completions.create(
            model=DEPLOYMENT,
            messages=[
                {"role": "system", "content": COMPATIBILITY_SYSTEM_PROMPT},
                {"role": "user", "content": json.dumps(context)},
            ],
            temperature=0.4,
            max_tokens=200,
        )
        content = response.choices[0].message.content
        return content.strip() if content else ""
    except Exception as e:
        logger.warning(f"[GPT-4o Compat FAILED] {e}")
        return ""


# ─── Regex Fallback: Parameter Extractor ──────────────────────────────────────


def extract_intent_regex(query: str) -> dict:
    """Regex/rule-based fallback when Azure OpenAI is unavailable."""
    q = query.lower().strip()
    intent: dict = {}

    if re.search(r"\bdenim\b", q):
        intent["category"] = "Denim"
    elif re.search(r"\bwoven|shirting|voile|linen|suiting|oxford|poplin|dobby\b", q):
        intent["category"] = "Wovens"
    elif re.search(r"\bfr\b|flame|aramid|nomex|protex|arc.?flash|chemical|esd|anti.?static|ppe|heat|dwr|water.?resist|barrier|hazard|advanced|technical", q):
        intent["category"] = "Advanced Materials"

    # Sub-category tags for Advanced Materials
    if re.search(r"\bfr\b|flame|fire|aramid|nomex|protex|arc.?flash|ppe\b", q):
        intent["tag"] = "FR"
    elif re.search(r"\bchemical\b", q):
        intent["tag"] = "chemical-resistant"
    elif re.search(r"\besd|anti.?static\b", q):
        intent["tag"] = "anti-static"

    if re.search(r"\bheavy|heavyweight|thick|rugged\b", q):
        intent["gsm_min"] = 350
    elif re.search(r"\blight|lightweight|sheer|thin|fine\b", q):
        intent["gsm_max"] = 150
    elif re.search(r"\bmedium|mid.?weight\b", q):
        intent["gsm_min"] = 150
        intent["gsm_max"] = 350

    gsm_match = re.search(r"(\d{2,3})\s*(?:gsm|g/?m2?)", q)
    if gsm_match:
        val = int(gsm_match.group(1))
        if re.search(r"above|over|more|>|min", q):
            intent["gsm_min"] = val
        elif re.search(r"below|under|less|<|max", q):
            intent["gsm_max"] = val
        else:
            intent["gsm_min"] = val - 30
            intent["gsm_max"] = val + 30

    # Check for explicit sustainability score threshold first
    sust_score_match = re.search(r"sustainab\w*\s*(?:score)?\s*(?:>|above|over|more\s+than|at\s+least|>=)\s*(\d+)", q)
    if sust_score_match:
        intent["min_sustainability_score"] = int(sust_score_match.group(1))
    elif re.search(r"\bsustain|eco|organic|recycl|green|bci|grs|gots|zld|fair.?trade|bluesign|ecolabel\b", q):
        intent["sustainable"] = True

    stretch_pct_match = re.search(r"stretch\s*(?:>|above|over|more\s+than|at\s+least|>=)\s*(\d+)\s*%?", q)
    if not stretch_pct_match:
        stretch_pct_match = re.search(r"(?:>|above|over|more\s+than|at\s+least|>=)\s*(\d+)\s*%\s*stretch", q)
    if stretch_pct_match:
        intent["min_stretch"] = int(stretch_pct_match.group(1))
    elif re.search(r"\bstretch|elastic|spandex|flex\b", q):
        intent["has_stretch"] = True

    weave_match = re.search(r"\b(3x1 rht|broken twill|plain|satin|twill|oxford|ripstop|dobby)\b", q)
    if weave_match:
        intent["weave"] = weave_match.group(1).title()

    if re.search(r"\bin.?stock|available|ready\b", q):
        intent["stock_status"] = "In Stock"

    # Stock quantity: "more than 45", "at least 50000 meters", "stock above 20000"
    stock_qty_min_match = re.search(r"(?:more\s+than|at\s+least|over|above|>|min(?:imum)?)\s*(\d+)\s*(?:k|thousand|,?000)?\s*(?:meters?|m\b|units?)?", q)
    stock_qty_max_match = re.search(r"(?:less\s+than|under|below|<|max(?:imum)?)\s*(\d+)\s*(?:k|thousand|,?000)?\s*(?:meters?|m\b|units?)?", q)
    if stock_qty_min_match and re.search(r"stock|inventor|quantit|in.?stock", q):
        val = int(stock_qty_min_match.group(1))
        intent["min_stock_quantity"] = val * 1000 if val < 1000 else val
        intent["stock_status"] = "In Stock"
    if stock_qty_max_match and re.search(r"stock|inventor|quantit|in.?stock", q):
        val = int(stock_qty_max_match.group(1))
        intent["max_stock_quantity"] = val * 1000 if val < 1000 else val

    # Explicit dollar amount: "under $5", "below $10", "less than $7", "<$8"
    # Require $ sign to avoid confusing stock quantity numbers with prices
    price_max_match = re.search(r"(?:under|below|less\s+than|cheaper\s+than|<)\s*\$(\d+(?:\.\d+)?)", q)
    price_min_match = re.search(r"(?:above|over|more\s+than|>)\s*\$(\d+(?:\.\d+)?)", q)
    if price_max_match:
        intent["max_price"] = float(price_max_match.group(1))
    elif re.search(r"\bcheap|budget|affordable|low.?cost|value\b", q):
        intent["max_price"] = 8.0
    if price_min_match:
        intent["min_price"] = float(price_min_match.group(1))
    elif re.search(r"\bpremium|luxury|high.?end|expensive\b", q):
        intent["min_price"] = 10.0

    color_match = re.search(r"\b(black|white|blue|indigo|navy|khaki|orange|green|red|silver|pink)\b", q)
    if color_match:
        intent["color"] = color_match.group(1).title()

    # General tags — only if not already set by FR/chemical/ESD detection above
    if "tag" not in intent:
        if re.search(r"\bformal|business|corporate|office\b", q):
            intent["tag"] = "formal"
        elif re.search(r"\bcasual|relax|weekend\b", q):
            intent["tag"] = "casual"
        elif re.search(r"\bworkwear|industrial|factory\b", q):
            intent["tag"] = "industrial"
        elif re.search(r"\bsummer|cool|breathab\b", q):
            intent["tag"] = "summer"
        elif re.search(r"\bheritage|vintage|classic|retro\b", q):
            intent["tag"] = "heritage"
        elif re.search(r"\bselvedge\b", q):
            intent["tag"] = "selvedge"

    cert_match = re.search(r"\b(nfpa|astm|en iso|iec|osha|aami)\b", q)
    if cert_match:
        intent["certification_keyword"] = cert_match.group(1).upper()

    return intent


# ─── Filter Engine ────────────────────────────────────────────────────────────


def filter_catalog(intent: dict, raw_query: str = "") -> list[dict]:
    """Apply extracted intent parameters as filters on the catalog."""
    results = CATALOG[:]

    if "category" in intent:
        results = [p for p in results if p["category"] == intent["category"]]

    if "gsm_min" in intent:
        results = [p for p in results if p["gsm"] >= intent["gsm_min"]]

    if "gsm_max" in intent:
        results = [p for p in results if p["gsm"] <= intent["gsm_max"]]

    if "min_sustainability_score" in intent:
        min_score = intent["min_sustainability_score"]
        results = [p for p in results if p.get("sustainability_score", 0) >= min_score]
    elif intent.get("sustainable"):
        results = [p for p in results if len(p.get("certifications", [])) > 0 and p.get("sustainability_score", 0) >= 40]

    if "min_stretch" in intent:
        results = [p for p in results if p.get("stretch", 0) >= intent["min_stretch"]]
    elif intent.get("has_stretch"):
        results = [p for p in results if p.get("stretch", 0) > 0]

    if "weave" in intent:
        w = intent["weave"].lower()
        results = [p for p in results if w in p["weave"].lower()]

    if "stock_status" in intent:
        results = [p for p in results if p["stock_status"] == intent["stock_status"]]

    if "min_stock_quantity" in intent:
        results = [p for p in results if p.get("stock_quantity_meters", 0) >= intent["min_stock_quantity"]]

    if "max_stock_quantity" in intent:
        results = [p for p in results if p.get("stock_quantity_meters", 0) <= intent["max_stock_quantity"]]

    if "max_price" in intent:
        results = [p for p in results if p["price_high"] < intent["max_price"]]

    if "min_price" in intent:
        results = [p for p in results if p["price_low"] > intent["min_price"]]

    if "color" in intent:
        c = intent["color"].lower()
        results = [p for p in results if c in p.get("color", "").lower()]

    if "tag" in intent:
        t = intent["tag"]
        results = [p for p in results if t in p.get("tags", [])]

    if "certification_keyword" in intent:
        kw = intent["certification_keyword"].lower()
        results = [p for p in results if any(kw in cert.lower() for cert in p.get("certifications", []))]

    # Fallback: full-text search across name, description, tags
    if not intent or not results:
        q = raw_query.lower().strip()
        if q:
            results = [
                p for p in CATALOG
                if q in p["name"].lower()
                or q in p["description"].lower()
                or any(q in tag for tag in p.get("tags", []))
                or q in p.get("category", "").lower()
                or q in p.get("subcategory", "").lower()
            ]

    return results


# ─── API Endpoints ────────────────────────────────────────────────────────────


@app.get("/")
def root():
    return {
        "service": "Sourcing Architect — Fabric Discovery Engine",
        "version": "2.0.0",
        "engine": f"Azure OpenAI ({DEPLOYMENT})" if (MODE == "live" and openai_client) else "Rule-based",
        "endpoints": ["/search", "/chat", "/compatibility/{product_id}", "/catalog"],
    }


@app.get("/search", response_model=SearchResponse)
def search(q: str = Query(..., min_length=1, description="Natural language search query")):
    """
    AI-powered fabric search endpoint.
    Uses GPT-4o to extract intent, filter catalog, and summarize results.
    Falls back to regex if Azure OpenAI is unavailable.
    """
    engine = "regex-fallback"
    t_start = time.perf_counter()

    if MODE == "live" and openai_client:
        try:
            t0 = time.perf_counter()
            intent = extract_intent_ai(q)
            t_intent = time.perf_counter() - t0
            logger.info(f"[PERF] Intent extraction: {t_intent:.2f}s")
            engine = "gpt-4o"
            # ── Regex overrides: exact values from the query override GPT-4o ──
            ql = q.lower()
            # Stretch % override
            _sm = re.search(r"stretch\s*(?:>|above|over|more\s+than|at\s+least|>=)\s*(\d+)\s*%?", ql)
            if not _sm:
                _sm = re.search(r"(?:>|above|over|more\s+than|at\s+least|>=)\s*(\d+)\s*%\s*stretch", ql)
            if _sm:
                intent["min_stretch"] = int(_sm.group(1))
                intent.pop("has_stretch", None)
            _pm = re.search(r"(?:under|below|less\s+than|cheaper\s+than|<)\s*\$(\d+(?:\.\d+)?)", ql)
            if _pm:
                intent["max_price"] = float(_pm.group(1))
            _pp = re.search(r"(?:above|over|more\s+than|>)\s*\$(\d+(?:\.\d+)?)", ql)
            if _pp:
                intent["min_price"] = float(_pp.group(1))
        except Exception:
            intent = extract_intent_regex(q)
    else:
        intent = extract_intent_regex(q)

    results = filter_catalog(intent, raw_query=q)

    # Generate AI summary
    if MODE == "live" and engine == "gpt-4o":
        t1 = time.perf_counter()
        ai_summary = generate_summary(q, results)
        logger.info(f"[PERF] Summary generation: {time.perf_counter() - t1:.2f}s")
    else:
        ai_summary = f"Found {len(results)} matching fabrics for \"{q}\"."

    t_total = time.perf_counter() - t_start
    logger.info(f"[PERF] Total search: {t_total:.2f}s | query='{q}' | results={len(results)}")

    return SearchResponse(
        query=q,
        intent=intent,
        ai_summary=ai_summary,
        result_count=len(results),
        results=results,
        engine=engine,
    )


@app.post("/chat", response_model=ChatResponse)
def chat(req: ChatRequest):
    """
    Conversational AI endpoint powered by GPT-4o.
    Full fabric sourcing consultant — answers questions, compares products,
    recommends alternatives, explains certifications, advises on construction.
    """
    messages = [{"role": "system", "content": CHAT_SYSTEM_PROMPT}]

    # Append conversation history
    for msg in req.history[-10:]:  # Keep last 10 messages for context window
        messages.append({"role": msg["role"], "content": msg["content"]})

    messages.append({"role": "user", "content": req.message})

    try:
        response = openai_client.chat.completions.create(
            model=DEPLOYMENT,
            messages=messages,
            temperature=0.5,
            max_tokens=800,
        )
        reply = response.choices[0].message.content.strip()

        # Extract product IDs mentioned in the reply
        product_ids = re.findall(r"ARV-[A-Z]{3}-\d{3}", reply)
        unique_ids = list(dict.fromkeys(product_ids))  # deduplicate, preserve order

        return ChatResponse(reply=reply, suggested_products=unique_ids)
    except Exception as e:
        logger.error(f"[Chat ERROR] {e}")
        return ChatResponse(
            reply="I'm having trouble connecting to the AI engine right now. Please try searching using the command bar above, or try again in a moment.",
            suggested_products=[],
        )


@app.get("/chat/stream")
def chat_stream(message: str = Query(...), history: str = Query(default="[]")):
    """
    Streaming chat endpoint — returns Server-Sent Events for real-time typing effect.
    """
    try:
        hist = json.loads(history)
    except Exception:
        hist = []

    messages = [{"role": "system", "content": CHAT_SYSTEM_PROMPT}]
    for msg in hist[-10:]:
        messages.append({"role": msg["role"], "content": msg["content"]})
    messages.append({"role": "user", "content": message})

    def event_generator():
        try:
            stream = openai_client.chat.completions.create(
                model=DEPLOYMENT,
                messages=messages,
                temperature=0.5,
                max_tokens=800,
                stream=True,
            )
            for chunk in stream:
                if chunk.choices and chunk.choices[0].delta.content:
                    token = chunk.choices[0].delta.content
                    yield f"data: {json.dumps({'token': token})}\n\n"
            yield f"data: {json.dumps({'done': True})}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'error': str(e)})}\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@app.get("/compatibility/{product_id}", response_model=CompatibilityResponse)
def get_compatibility(product_id: str):
    """
    Returns compatible linings and stitching threads for a given product,
    plus an AI-generated expert recommendation.
    """
    product = CATALOG_MAP.get(product_id)
    if not product:
        return CompatibilityResponse(
            product_id=product_id, linings=[], threads=[], ai_recommendation=""
        )

    lining_ids = product.get("compatible_linings", [])
    linings = [CATALOG_MAP[lid] for lid in lining_ids if lid in CATALOG_MAP]
    threads = product.get("compatible_threads", [])

    # Generate AI recommendation
    ai_recommendation = ""
    if MODE == "live" and openai_client:
        ai_recommendation = generate_compatibility_advice(product, linings, threads)

    return CompatibilityResponse(
        product_id=product_id,
        linings=linings,
        threads=threads,
        ai_recommendation=ai_recommendation,
    )


@app.get("/catalog")
def full_catalog():
    """Return the entire catalog (for initial load)."""
    return {"count": len(CATALOG), "products": CATALOG}


# ─── Run ──────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    import asyncio
    import signal

    # Bind address is config-driven; defaults to loopback only
    host = os.getenv("HOST", "127.0.0.1")
    port = int(os.getenv("PORT", "8000"))

    print("\n" + "="*60)
    print("🧵 SOURCING ARCHITECT — Fabric Discovery Engine")
    print("="*60)
    print(f"  Engine:       {'Azure OpenAI GPT-4o' if openai_client else 'Rule-based (no credentials)'}")
    print(f"  Deployment:   {DEPLOYMENT}")
    print(f"  Mode:         {MODE}")
    print(f"  Listening on: {host}:{port}")
    print("="*60 + "\n")

    # Windows-safe server startup (avoid uvicorn signal handler issues)
    config = uvicorn.Config("main:app", host=host, port=port, log_level="info")
    server = uvicorn.Server(config)

    # Disable uvicorn's problematic signal handlers on Windows
    server.install_signal_handlers = lambda: None

    async def serve():
        await server.serve()

    try:
        asyncio.run(serve())
    except KeyboardInterrupt:
        print("\n🛑 Server stopped.")
