"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { TagChip, formatTime } from "@/components/note-card";

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

interface TopicOption {
  id: string;
  name: string;
  isSystem: number;
}

// 紧凑 chip（configurator-option-chip 语法，选中态 2px Focus Blue）
function Chip({
  label,
  selected,
  muted,
  onClick,
}: {
  label: string;
  selected: boolean;
  muted?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`shrink-0 whitespace-nowrap rounded-chip border bg-surface px-4 py-1.5 text-[14px] transition-transform active:scale-95 ${
        selected
          ? "border-action-focus font-semibold text-ink ring-1 ring-inset ring-action-focus"
          : `border-hairline ${muted ? "text-ink-48" : "text-ink-80"}`
      }`}
    >
      {label}
    </button>
  );
}

export function SearchClient({ topics }: { topics: TopicOption[] }) {
  const [q, setQ] = useState("");
  const [topicId, setTopicId] = useState("");
  const [results, setResults] = useState<SearchItem[]>([]);
  const [terms, setTerms] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 普通主题与系统主题（未分类）分开渲染，两者层级不同
  const realTopics = topics.filter((t) => !t.isSystem);
  const systemTopics = topics.filter((t) => t.isSystem);

  // 输入防抖 300ms 自动搜索；只选主题不输关键词时，退化为按主题浏览
  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (!q.trim() && !topicId) {
      setResults([]);
      setSearched(false);
      return;
    }
    timerRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        if (q.trim()) params.set("q", q);
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
        <h1 className="font-serif text-display leading-[1.1] tracking-[-0.4px]">
          搜索
        </h1>
      </header>

      {/* 搜索框采用 utility 圆角（Apple search-input 语法，44px 高，输入控件保留发丝线） */}
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
          className="h-[44px] w-full rounded-utility border border-hairline bg-surface pl-11 pr-5 text-[17px] outline-none focus:border-action-focus"
        />
      </div>

      {/* 主题过滤：三段式，避免「全部主题 / 未分类 / 普通主题」被误读成并列项 */}
      <div className="mb-6 flex items-center gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <Chip label="全部主题" selected={topicId === ""} onClick={() => setTopicId("")} />
        {realTopics.length > 0 && <span className="h-5 w-px shrink-0 bg-hairline" aria-hidden />}
        {realTopics.map((t) => (
          <Chip key={t.id} label={t.name} selected={topicId === t.id} onClick={() => setTopicId(t.id)} />
        ))}
        {systemTopics.length > 0 && <span className="h-5 w-px shrink-0 bg-hairline" aria-hidden />}
        {systemTopics.map((t) => (
          <Chip key={t.id} label={t.name} muted selected={topicId === t.id} onClick={() => setTopicId(t.id)} />
        ))}
      </div>

      {loading && <p className="text-[14px] text-ink-48">搜索中…</p>}
      {!loading && searched && results.length === 0 && (
        <div className="rounded-card bg-surface p-10 text-center">
          <p className="font-serif text-2xl leading-tight text-ink">
            {q.trim() ? `没有找到匹配「${q}」的笔记` : "这个主题下还没有笔记"}
          </p>
        </div>
      )}

      <div>
        {results.map((r) => (
          <Link
            key={r.id}
            href={`/notes/${r.id}`}
            className="block border-b border-divider px-4 py-4 transition-colors hover:bg-fill active:bg-fill"
          >
            <div className="flex items-start justify-between gap-3">
              <p className="min-w-0 flex-1 truncate text-[17px] font-semibold tracking-[-0.374px]">
                <Highlight text={r.title} terms={terms} />
              </p>
              <span className="shrink-0 font-mono text-meta text-ink-48">{formatTime(r.updatedAt)}</span>
            </div>
            <p className="mt-1 line-clamp-2 text-[14px] leading-[1.43] text-ink-48">
              <Highlight text={r.excerpt} terms={terms} />
            </p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              <span className="rounded-chip bg-fill px-2.5 py-0.5 text-micro font-semibold uppercase tracking-[0.08em] text-action">
                {r.topicName}
              </span>
              {r.tags.map((t) => (
                <TagChip key={t} name={t} />
              ))}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
