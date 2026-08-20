"use client";

// 来源选择器：勾主题 + 搜笔记，确定后开一场来源问答。
// 主题勾的是「活引用」——之后往该主题新增的笔记会自动进入来源范围，
// 所以这里显示笔记条数只是当下的参考值，不是快照。

import { useCallback, useEffect, useState } from "react";
import type { SourceItem } from "@/lib/ai/sources";

interface TopicRow {
  id: string;
  name: string;
  noteCount: number;
}

interface NoteRow {
  id: string;
  title: string;
  topicName: string;
}

export function SourcePicker({
  initial,
  onCancel,
  onConfirm,
}: {
  initial: SourceItem[];
  onCancel: () => void;
  onConfirm: (picked: SourceItem[]) => void;
}) {
  const [topics, setTopics] = useState<TopicRow[]>([]);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<NoteRow[]>([]);
  const [searching, setSearching] = useState(false);
  // 以 `${type}:${id}` 为键，值是显示用标题
  const [picked, setPicked] = useState<Map<string, SourceItem>>(
    () => new Map(initial.map((s) => [`${s.type}:${s.id}`, s])),
  );

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/topics");
        if (res.ok) {
          const data = (await res.json()) as { topics?: TopicRow[] };
          setTopics(data.topics ?? []);
        }
      } catch {
        // 主题列表拿不到时仍可用搜索挑笔记
      }
    })();
  }, []);

  // 输入停顿后再搜，避免每敲一个字打一次接口
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults([]);
      return;
    }
    setSearching(true);
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
          if (res.ok) {
            const data = (await res.json()) as { results?: NoteRow[] };
            setResults((data.results ?? []).slice(0, 20));
          }
        } catch {
          setResults([]);
        } finally {
          setSearching(false);
        }
      })();
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  const toggle = useCallback((item: SourceItem) => {
    setPicked((prev) => {
      const next = new Map(prev);
      const key = `${item.type}:${item.id}`;
      if (next.has(key)) next.delete(key);
      else next.set(key, item);
      return next;
    });
  }, []);

  const has = (type: "note" | "topic", id: string) => picked.has(`${type}:${id}`);
  const list = [...picked.values()];

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-divider px-5 py-4">
        <p className="text-[14px] font-semibold tracking-[-0.224px]">选择来源</p>
        <button
          onClick={onCancel}
          className="rounded-utility px-2 py-1 text-[14px] text-ink-48 hover:bg-fill"
          aria-label="取消"
        >
          ✕
        </button>
      </div>

      <p className="border-b border-divider bg-fill/40 px-5 py-2 text-[12px] leading-[1.5] text-ink-48">
        AI 只会依据选中的内容回答，来源里没有的会直说没有。选主题后，之后新增到该主题的笔记也会自动算作来源。
      </p>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="px-5 py-3">
          <p className="mb-2 text-[12px] font-medium text-ink-48">按主题</p>
          <div className="flex flex-wrap gap-1.5">
            {topics.map((t) => (
              <button
                key={t.id}
                onClick={() => toggle({ type: "topic", id: t.id, label: t.name })}
                className={`rounded-chip border px-2.5 py-1 text-[12px] ${
                  has("topic", t.id)
                    ? "border-action bg-action text-white dark:text-cta-ink"
                    : "border-hairline text-ink-80 hover:bg-fill"
                }`}
              >
                {t.name}
                <span className={`font-mono ${has("topic", t.id) ? "opacity-70" : "text-ink-48"}`}> {t.noteCount}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="px-5 py-3">
          <p className="mb-2 text-[12px] font-medium text-ink-48">搜笔记</p>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="输入关键词查找笔记"
            className="w-full rounded-utility border border-hairline px-3 py-2 text-[13px] outline-none focus:border-action-focus"
          />
          {searching && <p className="mt-2 text-[12px] text-ink-48">搜索中…</p>}
          {!searching && query.trim() && results.length === 0 && (
            <p className="mt-2 text-[12px] text-ink-48">没有找到相关笔记</p>
          )}
          <div className="mt-2 space-y-1">
            {results.map((n) => (
              <button
                key={n.id}
                onClick={() => toggle({ type: "note", id: n.id, label: n.title })}
                className={`flex w-full items-start gap-2 rounded-utility px-2 py-1.5 text-left text-[13px] hover:bg-fill ${
                  has("note", n.id) ? "bg-fill" : ""
                }`}
              >
                <span className="mt-0.5 shrink-0 text-action">{has("note", n.id) ? "✓" : "＋"}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{n.title}</span>
                  <span className="block truncate text-[11px] text-ink-48">{n.topicName}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 已选清单：勾了什么必须一眼看得见，否则用户不敢信任「只从这些回答」 */}
      <div className="border-t border-divider px-5 py-3">
        {list.length === 0 ? (
          <p className="text-[12px] text-ink-48">还没有选择来源</p>
        ) : (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {list.map((s) => (
              <span
                key={`${s.type}:${s.id}`}
                className="flex max-w-full items-center gap-1 rounded-chip bg-fill px-2 py-1 text-[12px]"
              >
                <span className="text-ink-48">{s.type === "topic" ? "主题" : "笔记"}</span>
                <span className="min-w-0 truncate">{s.label}</span>
                <button
                  onClick={() => toggle(s)}
                  className="shrink-0 text-ink-48 hover:text-danger"
                  aria-label={`移除 ${s.label}`}
                >
                  ✕
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded-utility border border-hairline px-4 py-1.5 text-[13px] text-ink-48 active:scale-95"
          >
            取消
          </button>
          <button
            onClick={() => onConfirm(list)}
            disabled={list.length === 0}
            className="rounded-utility bg-cta px-4 py-1.5 text-[13px] text-cta-ink active:scale-95 disabled:opacity-40"
          >
            开始来源问答（{list.length}）
          </button>
        </div>
      </div>
    </div>
  );
}
