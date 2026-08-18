"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { formatTime } from "@/components/note-card";

interface SearchItem {
  id: string;
  title: string;
  excerpt: string;
  topicId: string;
  topicName: string;
  tags: string[];
  updatedAt: number;
}

// 命中词高亮
function Highlight({ text, terms }: { text: string; terms: string[] }) {
  if (terms.length === 0) return <>{text}</>;
  const pattern = terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const parts = text.split(new RegExp(`(${pattern})`, "g"));
  return (
    <>
      {parts.map((p, i) =>
        terms.includes(p) ? (
          <mark key={i} className="rounded bg-action/10 px-0.5 text-action">
            {p}
          </mark>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}

export function SearchClient({ topics }: { topics: { id: string; name: string }[] }) {
  const [q, setQ] = useState("");
  const [topicId, setTopicId] = useState("");
  const [results, setResults] = useState<SearchItem[]>([]);
  const [terms, setTerms] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 输入防抖 300ms 自动搜索
  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (!q.trim()) {
      setResults([]);
      setSearched(false);
      return;
    }
    timerRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams({ q });
        if (topicId) params.set("topicId", topicId);
        const res = await fetch(`/api/search?${params}`);
        if (res.ok) {
          const data = await res.json();
          setResults(data.results);
          setTerms(data.terms);
          setSearched(true);
        }
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [q, topicId]);

  return (
    <div>
      <header className="mb-8">
        <p className="mb-2 text-[12px] font-semibold tracking-[0.06em] text-ink-48">知了</p>
        <h1 className="text-[34px] font-semibold leading-[1.1] tracking-[-0.4px] md:text-[40px]">
          搜索
        </h1>
      </header>

      {/* 胶囊形搜索框（Apple search-input 语法，44px 高，输入控件保留发丝线） */}
      <div className="relative mb-4">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-48"
          aria-hidden
        >
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="搜索标题、正文、标签"
          autoFocus
          className="h-[44px] w-full rounded-full border border-hairline bg-surface pl-11 pr-5 text-[17px] outline-none focus:border-action-focus"
        />
      </div>

      {/* 主题过滤：胶囊 chips（configurator-option-chip 语法，选中态 2px Focus Blue） */}
      <div className="mb-6 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {[{ id: "", name: "全部主题" }, ...topics].map((t) => {
          const selectedChip = topicId === t.id;
          return (
            <button
              key={t.id || "all"}
              onClick={() => setTopicId(t.id)}
              className={`shrink-0 whitespace-nowrap rounded-full border bg-surface px-4 py-1.5 text-[14px] transition-transform active:scale-95 ${
                selectedChip
                  ? "border-action-focus font-semibold text-ink ring-1 ring-inset ring-action-focus"
                  : "border-hairline text-ink-80"
              }`}
            >
              {t.name}
            </button>
          );
        })}
      </div>

      {loading && <p className="text-[14px] text-ink-48">搜索中…</p>}
      {!loading && searched && results.length === 0 && (
        <div className="rounded-[18px] bg-surface p-10 text-center text-[14px] text-ink-48">
          没有找到匹配「{q}」的笔记
        </div>
      )}

      <div className="space-y-1.5">
        {results.map((r) => (
          <Link
            key={r.id}
            href={`/notes/${r.id}`}
            className="block rounded-[18px] bg-surface p-6 ring-hairline transition-[box-shadow,transform] hover:ring-1 active:scale-[0.99]"
          >
            <div className="flex items-start justify-between gap-3">
              <p className="min-w-0 flex-1 truncate text-[17px] font-semibold tracking-[-0.374px]">
                <Highlight text={r.title} terms={terms} />
              </p>
              <span className="shrink-0 text-[14px] text-ink-48">{formatTime(r.updatedAt)}</span>
            </div>
            <p className="mt-1 line-clamp-2 text-[14px] leading-[1.43] text-ink-48">
              <Highlight text={r.excerpt} terms={terms} />
            </p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              <span className="rounded-full bg-fill px-2.5 py-0.5 text-[12px] font-semibold text-action">
                {r.topicName}
              </span>
              {r.tags.map((t) => (
                <span key={t} className="rounded-full bg-fill px-2.5 py-0.5 text-[12px] text-ink-48">
                  {t}
                </span>
              ))}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
