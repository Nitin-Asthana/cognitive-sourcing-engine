"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/* ─── Types ───────────────────────────────────────────────────────────────── */

interface Product {
  id: string;
  name: string;
  category: string;
  subcategory: string;
  description: string;
  gsm: number;
  weave: string;
  stretch: number;
  composition: string;
  width_cm: number;
  finish: string;
  color: string;
  certifications: string[];
  price_tier: string;
  price_value: number;
  lead_time_weeks: number;
  moq_meters: number;
  stock_status: string;
  stock_quantity_meters: number;
  sustainability_score: number;
  compatible_linings: string[];
  compatible_threads: string[];
  tags: string[];
}

interface SearchResult {
  query: string;
  intent: Record<string, unknown>;
  ai_summary: string;
  result_count: number;
  results: Product[];
  engine: string;
}

interface CompatibilityData {
  product_id: string;
  linings: Product[];
  threads: string[];
  ai_recommendation: string;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  suggested_products?: string[];
}

// Backend URL is supplied via NEXT_PUBLIC_API_URL (see .env.example).
const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "";

/* ─── Certification Badge Colors ──────────────────────────────────────────── */

const CERT_COLORS: Record<string, string> = {
  BCI: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  GRS: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  GOTS: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  ZLD: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30",
  "OEKO-TEX 100": "bg-blue-500/20 text-blue-400 border-blue-500/30",
  "Fair Trade": "bg-amber-500/20 text-amber-400 border-amber-500/30",
  "EU Ecolabel": "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  bluesign: "bg-sky-500/20 text-sky-400 border-sky-500/30",
  "European Flax": "bg-amber-500/20 text-amber-400 border-amber-500/30",
  RWS: "bg-purple-500/20 text-purple-400 border-purple-500/30",
};

const getCertClass = (cert: string) =>
  CERT_COLORS[cert] || "bg-slate-600/30 text-slate-400 border-slate-500/30";

/* ─── Category Badge ──────────────────────────────────────────────────────── */

const CAT_COLORS: Record<string, string> = {
  Denim: "bg-indigo-500/20 text-indigo-400",
  Wovens: "bg-violet-500/20 text-violet-400",
  "Advanced Materials": "bg-orange-500/20 text-orange-400",
};

/* ─── Sustainability Ring ─────────────────────────────────────────────────── */

function SustainabilityRing({ score }: { score: number }) {
  const circumference = 2 * Math.PI * 16;
  const offset = circumference - (score / 100) * circumference;
  const color =
    score >= 80
      ? "text-emerald-400"
      : score >= 60
      ? "text-yellow-400"
      : "text-red-400";

  return (
    <div className="relative w-11 h-11 flex-shrink-0">
      <svg className="w-11 h-11 -rotate-90" viewBox="0 0 36 36">
        <circle
          cx="18"
          cy="18"
          r="16"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          className="text-slate-700"
        />
        <circle
          cx="18"
          cy="18"
          r="16"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          className={color}
        />
      </svg>
      <span
        className={`absolute inset-0 flex items-center justify-center text-[10px] font-bold ${color}`}
      >
        {score}
      </span>
    </div>
  );
}

/* ─── Fabric Card ─────────────────────────────────────────────────────────── */

function FabricCard({
  product,
  onSelect,
  isSelected,
}: {
  product: Product;
  onSelect: (p: Product) => void;
  isSelected: boolean;
}) {
  return (
    <div
      onClick={() => onSelect(product)}
      className={`group relative rounded-xl border transition-all duration-200 cursor-pointer overflow-hidden
        ${
          isSelected
            ? "border-indigo-500 bg-slate-800/80 ring-1 ring-indigo-500/40 shadow-lg shadow-indigo-500/10"
            : "border-slate-700/60 bg-slate-900/60 hover:border-slate-600 hover:bg-slate-800/50 hover:shadow-lg hover:shadow-black/20"
        }`}
    >
      {/* Category Ribbon */}
      <div className="absolute top-0 right-0">
        <div
          className={`px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider rounded-bl-lg ${
            CAT_COLORS[product.category] || "bg-slate-700 text-slate-300"
          }`}
        >
          {product.category}
        </div>
      </div>

      <div className="p-4 space-y-3">
        {/* Header */}
        <div className="pr-24">
          <h3 className="text-base font-semibold text-white group-hover:text-indigo-300 transition-colors">
            {product.name}
          </h3>
          <p className="text-xs font-mono text-slate-500">{product.id}</p>
        </div>

        {/* Description */}
        <p className="text-xs text-slate-400 leading-relaxed line-clamp-2">
          {product.description}
        </p>

        {/* Technical Spec Grid */}
        <div className="grid grid-cols-3 gap-2">
          <div className="bg-slate-800/80 rounded-lg p-2 text-center">
            <p className="text-[10px] text-slate-500 uppercase tracking-wide">
              GSM
            </p>
            <p className="text-sm font-bold text-white">{product.gsm}</p>
          </div>
          <div className="bg-slate-800/80 rounded-lg p-2 text-center">
            <p className="text-[10px] text-slate-500 uppercase tracking-wide">
              Weave
            </p>
            <p className="text-[11px] font-semibold text-white leading-tight">
              {product.weave}
            </p>
          </div>
          <div className="bg-slate-800/80 rounded-lg p-2 text-center">
            <p className="text-[10px] text-slate-500 uppercase tracking-wide">
              Stretch
            </p>
            <p className="text-sm font-bold text-white">
              {product.stretch > 0 ? `${product.stretch}%` : "—"}
            </p>
          </div>
        </div>

        {/* Composition */}
        <div className="text-[11px] text-slate-400">
          <span className="text-slate-500 font-medium">Comp:</span>{" "}
          {product.composition}
        </div>

        {/* Sustainability Badges */}
        {product.certifications.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {product.certifications.slice(0, 4).map((cert) => (
              <span
                key={cert}
                className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-semibold border ${getCertClass(
                  cert
                )}`}
              >
                {cert}
              </span>
            ))}
            {product.certifications.length > 4 && (
              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-semibold bg-slate-700/50 text-slate-400 border border-slate-600/30">
                +{product.certifications.length - 4}
              </span>
            )}
          </div>
        )}

        {/* Footer: Commercials + Sustainability Score */}
        <div className="flex items-center justify-between pt-2 border-t border-slate-700/50">
          <div className="space-y-0.5">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-white">
                {product.price_tier}
              </span>
              <span className="text-[10px] text-slate-500">/meter</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-[10px] text-slate-500">
                Lead:{" "}
                <span className="text-slate-300 font-medium">
                  {product.lead_time_weeks}w
                </span>
              </span>
              <span className="text-[10px] text-slate-500">
                MOQ:{" "}
                <span className="text-slate-300 font-medium">
                  {product.moq_meters.toLocaleString()}m
                </span>
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Stock badge */}
            <span
              className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                product.stock_status === "In Stock"
                  ? "bg-emerald-500/20 text-emerald-400"
                  : "bg-amber-500/20 text-amber-400"
              }`}
            >
              {product.stock_status}
            </span>
            {product.stock_quantity_meters > 0 && (
              <span className="text-[10px] text-slate-400 font-medium">
                {product.stock_quantity_meters >= 1000
                  ? `${(product.stock_quantity_meters / 1000).toFixed(0)}K m`
                  : `${product.stock_quantity_meters} m`}
              </span>
            )}
            <SustainabilityRing score={product.sustainability_score} />
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Compatibility Drawer ────────────────────────────────────────────────── */

function CompatibilityDrawer({
  product,
  compatibility,
  loading,
  onClose,
  onSelectLining,
  onBack,
}: {
  product: Product | null;
  compatibility: CompatibilityData | null;
  loading: boolean;
  onClose: () => void;
  onSelectLining?: (product: Product) => void;
  onBack?: () => void;
}) {
  if (!product) return null;

  return (
    <div
      className={`fixed inset-y-0 right-0 w-[420px] bg-slate-900 border-l border-slate-700/60 shadow-2xl shadow-black/40 z-50 
        transform transition-transform duration-300 ease-out overflow-y-auto
        ${product ? "translate-x-0" : "translate-x-full"}`}
    >
      {/* Header */}
      <div className="sticky top-0 bg-slate-900/95 backdrop-blur-sm border-b border-slate-700/60 p-5 z-10">
        <div className="flex items-start justify-between">
          <div>
            {onBack && (
              <button
                onClick={onBack}
                className="flex items-center gap-1 text-[11px] text-indigo-400 hover:text-indigo-300 mb-1.5 transition-colors font-medium"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
                Back to previous
              </button>
            )}
            <p className="text-[10px] text-indigo-400 font-semibold uppercase tracking-widest">
              Compatibility Analysis
            </p>
            <h2 className="text-lg font-bold text-white mt-1">
              {product.name}
            </h2>
            <p className="text-xs font-mono text-slate-500">{product.id}</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      <div className="p-5 space-y-6">
        {/* Product Summary */}
        <div className="bg-slate-800/60 rounded-xl p-4 space-y-3 border border-slate-700/40">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
            Selected Fabric
          </h3>
          <div className="grid grid-cols-2 gap-3">
            <InfoCell label="Category" value={product.subcategory} />
            <InfoCell label="GSM" value={String(product.gsm)} />
            <InfoCell label="Weave" value={product.weave} />
            <InfoCell label="Width" value={`${product.width_cm} cm`} />
            <InfoCell label="Finish" value={product.finish} />
            <InfoCell label="Color" value={product.color} />
          </div>
          <div className="pt-2 border-t border-slate-700/40">
            <p className="text-[11px] text-slate-400">
              <span className="text-slate-500">Composition:</span>{" "}
              {product.composition}
            </p>
          </div>
        </div>

        {/* Loading State */}
        {loading && (
          <div className="flex items-center justify-center py-12">
            <div className="flex items-center gap-3 text-slate-400">
              <svg className="animate-spin h-5 w-5 text-indigo-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              <span className="text-sm">AI analyzing compatibility…</span>
            </div>
          </div>
        )}

        {/* AI Recommendation */}
        {compatibility?.ai_recommendation && (
          <div className="bg-gradient-to-br from-indigo-500/10 to-violet-500/10 border border-indigo-500/20 rounded-xl p-4 space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-xs">🤖</span>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-indigo-400">
                AI Expert Recommendation
              </h3>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed">
              {compatibility.ai_recommendation}
            </p>
          </div>
        )}

        {/* Matching Linings */}
        {compatibility && (
          <>
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <div className="w-1 h-4 bg-indigo-500 rounded-full" />
                <h3 className="text-sm font-semibold text-white">
                  Matching Linings
                </h3>
                <span className="text-xs text-slate-500">
                  ({compatibility.linings.length})
                </span>
              </div>

              {compatibility.linings.length === 0 ? (
                <p className="text-xs text-slate-500 italic pl-3">
                  No specific lining recommendations for this fabric type.
                </p>
              ) : (
                <div className="space-y-2">
                  {compatibility.linings.map((lining) => (
                    <div
                      key={lining.id}
                      onClick={() => onSelectLining?.(lining)}
                      className="bg-slate-800/40 border border-slate-700/40 rounded-lg p-3 hover:border-indigo-500/30 transition-colors cursor-pointer group/lining"
                    >
                      <div className="flex items-start justify-between">
                        <div>
                          <p className="text-sm font-semibold text-white group-hover/lining:text-indigo-300 transition-colors">
                            {lining.name}
                          </p>
                          <p className="text-[10px] font-mono text-slate-500">
                            {lining.id}
                          </p>
                        </div>
                        <span className="text-[10px] font-semibold text-indigo-400 bg-indigo-500/10 px-2 py-0.5 rounded">
                          {lining.gsm} GSM
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-400 mt-1.5 line-clamp-2">
                        {lining.description}
                      </p>
                      <div className="flex items-center justify-between mt-2">
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] text-slate-500">
                            {lining.price_tier}/m
                          </span>
                          <span className="text-[10px] text-slate-600">•</span>
                          <span className="text-[10px] text-slate-500">
                            {lining.weave}
                          </span>
                        </div>
                        <span className="text-[10px] text-indigo-400 opacity-0 group-hover/lining:opacity-100 transition-opacity font-medium">
                          View →
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Stitching Threads */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <div className="w-1 h-4 bg-emerald-500 rounded-full" />
                <h3 className="text-sm font-semibold text-white">
                  Stitching Threads
                </h3>
                <span className="text-xs text-slate-500">
                  ({compatibility.threads.length})
                </span>
              </div>

              <div className="grid gap-2">
                {compatibility.threads.map((thread) => (
                  <div
                    key={thread}
                    className="flex items-center gap-3 bg-slate-800/40 border border-slate-700/40 rounded-lg px-3 py-2.5"
                  >
                    <div className="w-2 h-2 rounded-full bg-emerald-500 flex-shrink-0" />
                    <span className="text-sm text-slate-300">{thread}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Quick Spec Comparison */}
            <div className="bg-gradient-to-br from-indigo-500/10 to-purple-500/10 border border-indigo-500/20 rounded-xl p-4 space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-indigo-400">
                Quick Specs
              </h3>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="text-slate-400">
                  Price Range:{" "}
                  <span className="text-white font-semibold">
                    {product.price_tier}
                  </span>
                </div>
                <div className="text-slate-400">
                  Lead Time:{" "}
                  <span className="text-white font-semibold">
                    {product.lead_time_weeks} weeks
                  </span>
                </div>
                <div className="text-slate-400">
                  MOQ:{" "}
                  <span className="text-white font-semibold">
                    {product.moq_meters.toLocaleString()} meters
                  </span>
                </div>
                <div className="text-slate-400">
                  Sustainability:{" "}
                  <span
                    className={`font-semibold ${
                      product.sustainability_score >= 80
                        ? "text-emerald-400"
                        : product.sustainability_score >= 60
                        ? "text-yellow-400"
                        : "text-red-400"
                    }`}
                  >
                    {product.sustainability_score}/100
                  </span>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function InfoCell({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] text-slate-500 uppercase tracking-wide">
        {label}
      </p>
      <p className="text-xs font-medium text-slate-300">{value}</p>
    </div>
  );
}

/* ─── Intent Chips ────────────────────────────────────────────────────────── */

function IntentChips({ intent }: { intent: Record<string, unknown> }) {
  const entries = Object.entries(intent);
  if (entries.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1.5">
      {entries.map(([key, value]) => (
        <span
          key={key}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-indigo-500/10 border border-indigo-500/20 text-[10px] text-indigo-400"
        >
          <span className="font-semibold">{key}:</span>{" "}
          <span className="text-indigo-300">{String(value)}</span>
        </span>
      ))}
    </div>
  );
}

/* ─── Quick Filter Pills ──────────────────────────────────────────────────── */

const QUICK_FILTERS = [
  { label: "All Denim", query: "denim" },
  { label: "Sustainable", query: "sustainable" },
  { label: "Heavy Weight", query: "heavy" },
  { label: "Stretch Fabrics", query: "stretch" },
  { label: "Flame Resistant", query: "flame resistant" },
  { label: "Premium", query: "premium luxury" },
  { label: "In Stock", query: "in stock" },
  { label: "Formal Shirting", query: "formal shirting woven" },
  { label: "Lightweight", query: "lightweight" },
  { label: "PPE / Industrial", query: "PPE industrial" },
];

/* ─── Main Page ───────────────────────────────────────────────────────────── */

export default function ArvindAIPage() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Product[]>([]);
  const [intent, setIntent] = useState<Record<string, unknown>>({});
  const [aiSummary, setAiSummary] = useState("");
  const [engine, setEngine] = useState("");
  const [resultCount, setResultCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [initialLoaded, setInitialLoaded] = useState(false);

  // Drawer state
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [compatibility, setCompatibility] =
    useState<CompatibilityData | null>(null);
  const [drawerLoading, setDrawerLoading] = useState(false);
  const [productHistory, setProductHistory] = useState<Product[]>([]);

  // Chat state
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const inputRef = useRef<HTMLInputElement>(null);

  // Load full catalog on mount
  useEffect(() => {
    fetch(`${API_BASE}/catalog`)
      .then((r) => r.json())
      .then((data) => {
        setResults(data.products || []);
        setResultCount(data.count || 0);
        setInitialLoaded(true);
      })
      .catch(() => setInitialLoaded(true));
  }, []);

  // Scroll chat to bottom
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages]);

  // Search handler
  const handleSearch = useCallback(
    async (searchQuery?: string) => {
      const q = searchQuery ?? query;
      if (!q.trim()) {
        const res = await fetch(`${API_BASE}/catalog`);
        const data = await res.json();
        setResults(data.products || []);
        setResultCount(data.count || 0);
        setIntent({});
        setAiSummary("");
        setEngine("");
        return;
      }

      setLoading(true);
      try {
        const res = await fetch(
          `${API_BASE}/search?q=${encodeURIComponent(q)}`
        );
        const data: SearchResult = await res.json();
        setResults(data.results);
        setResultCount(data.result_count);
        setIntent(data.intent);
        setAiSummary(data.ai_summary || "");
        setEngine(data.engine || "");
      } catch {
        console.error("Search failed");
      } finally {
        setLoading(false);
      }
    },
    [query]
  );

  // Compatibility drawer
  const handleSelectProduct = async (product: Product, fromLining = false) => {
    if (selectedProduct?.id === product.id) {
      setSelectedProduct(null);
      setCompatibility(null);
      setProductHistory([]);
      return;
    }

    if (fromLining && selectedProduct) {
      setProductHistory((prev) => [...prev, selectedProduct]);
    } else {
      setProductHistory([]);
    }

    setSelectedProduct(product);
    setDrawerLoading(true);
    setCompatibility(null);

    try {
      const res = await fetch(`${API_BASE}/compatibility/${product.id}`);
      const data: CompatibilityData = await res.json();
      setCompatibility(data);
    } catch {
      console.error("Compatibility fetch failed");
    } finally {
      setDrawerLoading(false);
    }
  };

  const handleQuickFilter = (filterQuery: string) => {
    setQuery(filterQuery);
    handleSearch(filterQuery);
  };

  // Chat handler
  const handleChatSend = async () => {
    if (!chatInput.trim() || chatLoading) return;

    const userMsg: ChatMessage = { role: "user", content: chatInput };
    setChatMessages((prev) => [...prev, userMsg]);
    setChatInput("");
    setChatLoading(true);

    try {
      const history = chatMessages.map((m) => ({
        role: m.role,
        content: m.content,
      }));
      const res = await fetch(`${API_BASE}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: chatInput, history }),
      });
      const data = await res.json();
      const assistantMsg: ChatMessage = {
        role: "assistant",
        content: data.reply,
        suggested_products: data.suggested_products,
      };
      setChatMessages((prev) => [...prev, assistantMsg]);
    } catch {
      setChatMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: "Sorry, I couldn't connect to the AI engine. Please try again.",
        },
      ]);
    } finally {
      setChatLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      {/* ── Top Nav ─────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-40 bg-slate-950/80 backdrop-blur-xl border-b border-slate-800/60">
        <div className="max-w-[1600px] mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            {/* Brand */}
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-indigo-500 to-indigo-700 flex items-center justify-center shadow-lg shadow-indigo-500/20">
                <span className="text-white font-black text-[10px]">SA</span>
              </div>
              <div>
                <h1 className="text-base font-bold text-white tracking-tight">
                  Sourcing Architect
                </h1>
                <p className="text-[10px] text-slate-500 uppercase tracking-widest">
                  Fabric Discovery Engine
                </p>
              </div>
            </div>

            {/* Stats + Chat Toggle */}
            <div className="flex items-center gap-4">
              <div className="hidden md:flex items-center gap-6 text-xs text-slate-500">
                <div>
                  Catalog:{" "}
                  <span className="text-white font-semibold">30 SKUs</span>
                </div>
                <div>
                  Engine:{" "}
                  <span className="text-indigo-400 font-semibold">
                    GPT-4o
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  AI Online
                </div>
              </div>
              <button
                onClick={() => setChatOpen(!chatOpen)}
                className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold transition-all ${
                  chatOpen
                    ? "bg-indigo-600 text-white shadow-lg shadow-indigo-500/30"
                    : "bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700"
                }`}
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
                AI Chat
              </button>
            </div>
          </div>
        </div>
      </header>

      <div className="flex">
        {/* ── Main Content ──────────────────────────────────────────────── */}
        <main
          className={`flex-1 max-w-[1600px] mx-auto px-6 py-8 transition-all duration-300 ${
            selectedProduct ? "mr-[420px]" : ""
          } ${chatOpen ? "mr-[440px]" : ""}`}
          style={selectedProduct && chatOpen ? { marginRight: "860px" } : undefined}
        >
          {/* ── Command Bar ──────────────────────────────────────────── */}
          <div className="max-w-3xl mx-auto mb-8 space-y-4">
            <div className="relative">
              <div className="absolute inset-y-0 left-4 flex items-center pointer-events-none">
                <svg
                  className="w-5 h-5 text-slate-500"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                  />
                </svg>
              </div>
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => {
                  const v = e.target.value;
                  setQuery(v);
                  if (v.trim() === "") handleSearch("");
                }}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                placeholder='Try: "sustainable heavy denim" or "flame resistant PPE in stock"'
                className="w-full pl-12 pr-28 py-4 rounded-xl bg-slate-900 border border-slate-700/60 text-white placeholder-slate-500 
                           focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20
                           text-sm transition-all shadow-lg shadow-black/20"
              />
              <button
                onClick={() => handleSearch()}
                disabled={loading}
                className="absolute right-2 top-1/2 -translate-y-1/2 px-5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 
                           text-white text-sm font-semibold transition-colors disabled:opacity-50 shadow-lg shadow-indigo-500/20"
              >
                {loading ? (
                  <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                ) : (
                  "Search"
                )}
              </button>
            </div>

            {/* Quick Filters */}
            <div className="flex flex-wrap gap-2 justify-center">
              {QUICK_FILTERS.map((f) => (
                <button
                  key={f.label}
                  onClick={() => handleQuickFilter(f.query)}
                  className={`px-3 py-1 rounded-full text-[11px] font-medium border transition-all
                    ${
                      query === f.query
                        ? "bg-indigo-500/20 border-indigo-500/40 text-indigo-300"
                        : "bg-slate-800/50 border-slate-700/40 text-slate-400 hover:border-slate-600 hover:text-slate-300"
                    }`}
                >
                  {f.label}
                </button>
              ))}
            </div>

            {/* AI Summary */}
            {aiSummary && (
              <div className="bg-gradient-to-r from-indigo-500/10 via-purple-500/5 to-slate-900/0 border border-indigo-500/20 rounded-xl px-4 py-3 space-y-1.5">
                <div className="flex items-center gap-2">
                  <span className="text-xs">🤖</span>
                  <p className="text-[10px] text-indigo-400 uppercase tracking-widest font-semibold">
                    AI Summary
                  </p>
                  {engine && (
                    <span className="px-1.5 py-0.5 rounded text-[9px] font-mono bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                      {engine}
                    </span>
                  )}
                </div>
                <p className="text-sm text-slate-300 leading-relaxed">
                  {aiSummary}
                </p>
              </div>
            )}

            {/* Intent Display */}
            {Object.keys(intent).length > 0 && (
              <div className="bg-slate-900/60 border border-slate-800/60 rounded-lg px-4 py-2.5 space-y-1.5">
                <p className="text-[10px] text-slate-500 uppercase tracking-widest font-semibold">
                  Extracted Intent
                </p>
                <IntentChips intent={intent} />
              </div>
            )}
          </div>

          {/* ── Results Header ─────────────────────────────────────────── */}
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-3">
              <h2 className="text-sm font-semibold text-slate-300">
                {query ? "Search Results" : "Full Catalog"}
              </h2>
              <span className="px-2 py-0.5 rounded-md bg-slate-800 text-xs font-mono text-slate-400">
                {resultCount}
              </span>
            </div>
            {query && (
              <button
                onClick={() => {
                  setQuery("");
                  handleSearch("");
                }}
                className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
              >
                Clear filters ×
              </button>
            )}
          </div>

          {/* ── Product Grid ───────────────────────────────────────────── */}
          {!initialLoaded ? (
            <div className="flex items-center justify-center py-20">
              <div className="flex items-center gap-3 text-slate-500">
                <svg className="animate-spin h-5 w-5 text-indigo-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                <span className="text-sm">Loading catalog…</span>
              </div>
            </div>
          ) : results.length === 0 ? (
            <div className="text-center py-20">
              <div className="text-4xl mb-4">🔍</div>
              <h3 className="text-lg font-semibold text-slate-300 mb-2">
                No fabrics found
              </h3>
              <p className="text-sm text-slate-500 max-w-md mx-auto">
                Try adjusting your search query. Examples: &quot;sustainable
                denim&quot;, &quot;lightweight woven&quot;, &quot;flame resistant
                PPE&quot;
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {results.map((product) => (
                <FabricCard
                  key={product.id}
                  product={product}
                  onSelect={handleSelectProduct}
                  isSelected={selectedProduct?.id === product.id}
                />
              ))}
            </div>
          )}
        </main>

        {/* ── AI Chat Panel ────────────────────────────────────────────── */}
        {chatOpen && (
          <div className="fixed inset-y-0 right-0 w-[440px] bg-slate-900 border-l border-slate-700/60 shadow-2xl shadow-black/40 z-50 flex flex-col">
            {/* Chat Header */}
            <div className="flex-shrink-0 bg-slate-900/95 backdrop-blur-sm border-b border-slate-700/60 p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center">
                    <span className="text-white text-xs">🤖</span>
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-white">
                      Sourcing Architect
                    </h3>
                    <p className="text-[10px] text-emerald-400 font-medium">
                      Powered by GPT-4o • Online
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setChatOpen(false)}
                  className="p-2 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Chat Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {chatMessages.length === 0 && (
                <div className="text-center py-12 space-y-4">
                  <div className="text-4xl">🧵</div>
                  <div className="space-y-2">
                    <h4 className="text-sm font-semibold text-slate-300">
                      Ask me anything about fabrics
                    </h4>
                    <p className="text-xs text-slate-500 max-w-xs mx-auto">
                      I can compare products, suggest alternatives, explain certifications, and advise on garment construction.
                    </p>
                  </div>
                  <div className="space-y-2">
                    {[
                      "Compare Indigo Museum vs Khadi Denim",
                      "What's the best FR fabric for oil & gas?",
                      "Suggest sustainable denim under $9/meter",
                      "Explain ZLD certification",
                    ].map((suggestion) => (
                      <button
                        key={suggestion}
                        onClick={() => {
                          setChatInput(suggestion);
                        }}
                        className="block w-full text-left px-3 py-2 rounded-lg bg-slate-800/50 border border-slate-700/30 text-xs text-slate-400 hover:text-slate-200 hover:border-slate-600 transition-all"
                      >
                        {suggestion}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {chatMessages.map((msg, i) => (
                <div
                  key={i}
                  className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[85%] rounded-xl px-3.5 py-2.5 text-sm leading-relaxed ${
                      msg.role === "user"
                        ? "bg-indigo-600 text-white rounded-br-sm"
                        : "bg-slate-800 text-slate-200 border border-slate-700/40 rounded-bl-sm"
                    }`}
                  >
                    {msg.role === "user" ? (
                      <div className="whitespace-pre-wrap">{msg.content}</div>
                    ) : (
                      <div className="chat-markdown">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {msg.content}
                        </ReactMarkdown>
                      </div>
                    )}
                    {msg.suggested_products && msg.suggested_products.length > 0 && (
                      <div className="mt-2 pt-2 border-t border-slate-600/30 flex flex-wrap gap-1">
                        {msg.suggested_products.map((pid) => (
                          <span
                            key={pid}
                            className="px-1.5 py-0.5 rounded text-[9px] font-mono bg-indigo-500/20 text-indigo-300 border border-indigo-500/20 cursor-pointer hover:bg-indigo-500/30"
                            onClick={() => {
                              setQuery(pid);
                              handleSearch(pid);
                            }}
                          >
                            {pid}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}

              {chatLoading && (
                <div className="flex justify-start">
                  <div className="bg-slate-800 border border-slate-700/40 rounded-xl rounded-bl-sm px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="flex gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-bounce" style={{ animationDelay: "0ms" }} />
                        <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-bounce" style={{ animationDelay: "150ms" }} />
                        <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-bounce" style={{ animationDelay: "300ms" }} />
                      </div>
                      <span className="text-xs text-slate-500">Thinking…</span>
                    </div>
                  </div>
                </div>
              )}

              <div ref={chatEndRef} />
            </div>

            {/* Chat Input */}
            <div className="flex-shrink-0 border-t border-slate-700/60 p-4">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleChatSend()}
                  placeholder="Ask about fabrics, specs, pricing…"
                  className="flex-1 px-3.5 py-2.5 rounded-lg bg-slate-800 border border-slate-700/60 text-sm text-white placeholder-slate-500
                             focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/20"
                />
                <button
                  onClick={handleChatSend}
                  disabled={chatLoading || !chatInput.trim()}
                  className="px-4 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white transition-colors disabled:opacity-40"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Compatibility Drawer ───────────────────────────────────────── */}
      {selectedProduct && !chatOpen && (
        <div
          className="fixed inset-0 bg-black/30 z-40 md:hidden"
          onClick={() => {
            setSelectedProduct(null);
            setCompatibility(null);
          }}
        />
      )}
      {!chatOpen && (
        <CompatibilityDrawer
          product={selectedProduct}
          compatibility={compatibility}
          loading={drawerLoading}
          onClose={() => {
            setSelectedProduct(null);
            setCompatibility(null);
            setProductHistory([]);
          }}
          onSelectLining={(p) => handleSelectProduct(p, true)}
          onBack={
            productHistory.length > 0
              ? () => {
                  const prev = productHistory[productHistory.length - 1];
                  setProductHistory((h) => h.slice(0, -1));
                  handleSelectProduct(prev);
                }
              : undefined
          }
        />
      )}
    </div>
  );
}
