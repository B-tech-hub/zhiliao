"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { Note } from "@/db/schema";
import { BackButton } from "@/components/back-button";
import { AskWithSourcesButton } from "@/components/chat/ask-with-sources";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { COMMAND_EVENTS } from "@/components/command-events";

// TipTap 体积较大，懒加载拆出主包；占位与编辑区等高避免布局跳动
const MarkdownEditor = dynamic(
  () => import("@/components/markdown-editor").then((m) => m.MarkdownEditor),
  {
    ssr: false,
    loading: () => (
      <div className="min-h-0 flex-1 animate-pulse space-y-3 overflow-hidden">
        <div className="h-4 w-full rounded bg-veil/5" />
        <div className="h-4 w-11/12 rounded bg-veil/5" />
        <div className="h-4 w-4/5 rounded bg-veil/5" />
      </div>
    ),
  },
);

interface TopicOption {
  id: string;
  name: string;
  isSystem: number;
}

interface RelatedNote {
  id: string;
  title: string;
  excerpt: string;
  tags: string[];
}

interface ConflictHint {
  noteId: string;
  reason: string;
}

const AI_STATUS_TEXT: Record<string, string> = {
  pending: "等待 AI 整理",
  processing: "AI 整理中…",
  failed: "AI 整理失败",
  done: "",
  skipped: "",
};

// 笔记编辑器：TipTap 所见即所得 + 2 秒防抖自动保存
export function NoteEditor({
  note,
  tags: initialTags,
  topics,
  backHref,
}: {
  note: Note;
  tags: string[];
  topics: TopicOption[];
  // 无浏览器历史时的返回兜底路径（服务端按所属主题算好传入）
  backHref: string;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(note.title);
  const [content, setContent] = useState(note.content);
  const [topicId, setTopicId] = useState(note.topicId);
  const [tagsText, setTagsText] = useState(initialTags.join(", "));
  const [saveState, setSaveState] = useState<"idle" | "dirty" | "saving" | "saved" | "error">("idle");
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // 目录里高亮的那一节（按标题文本比对，与 data-heading-text 锚点同一套判据）
  const [activeHeading, setActiveHeading] = useState("");
  // 专注模式：藏起工具行、目录与标签行，只留标题与正文
  const [focusMode, setFocusMode] = useState(false);
  const [related, setRelated] = useState<RelatedNote[]>([]);
  const [conflicts, setConflicts] = useState<ConflictHint[]>([]);
  const [relatedLoading, setRelatedLoading] = useState(false);
  const headings = useMemo(() => Array.from(content.matchAll(/^(#{1,3})\s+(.+)$/gm)).map((m, i) => ({ level: m[1].length, text: m[2].trim(), id: `heading-${i}` })), [content]);
  const transcriptionWarnings = useMemo(() => {
    try { return note.transcriptionWarnings ? JSON.parse(note.transcriptionWarnings) as string[] : []; }
    catch { return ["转写告警数据无法解析"]; }
  }, [note.transcriptionWarnings]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedContentRef = useRef(note.content);
  const contentRef = useRef(note.content);
  const relatedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const relatedRequestRef = useRef(0);

  // 正文稳定一小段时间后才召回，避免每次击键都触发 Embedding/LLM 请求。
  useEffect(() => {
    if (relatedTimerRef.current) clearTimeout(relatedTimerRef.current);
    if (content.trim().length < 20) {
      relatedRequestRef.current += 1;
      setRelatedLoading(false);
      setRelated([]);
      setConflicts([]);
      return;
    }
    relatedTimerRef.current = setTimeout(async () => {
      const requestId = ++relatedRequestRef.current;
      setRelatedLoading(true);
      try {
        const res = await fetch(`/api/notes/${note.id}/related`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content }),
        });
        if (!res.ok) return;
        const data = await res.json() as { results?: RelatedNote[]; conflicts?: ConflictHint[] };
        if (requestId !== relatedRequestRef.current) return;
        setRelated(data.results ?? []);
        setConflicts(data.conflicts ?? []);
      } catch {
        // 相关笔记是辅助能力，网络或模型失败不影响编辑与保存。
      } finally {
        if (requestId === relatedRequestRef.current) setRelatedLoading(false);
      }
    }, 900);
    return () => {
      if (relatedTimerRef.current) clearTimeout(relatedTimerRef.current);
    };
  }, [content, note.id]);

  const patch = useCallback(
    async (body: Record<string, unknown>) => {
      setSaveState("saving");
      try {
        const res = await fetch(`/api/notes/${note.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          setSaveState("error");
          return false;
        }
        setSaveState("saved");
        return true;
      } catch {
        setSaveState("error");
        return false;
      }
    },
    [note.id],
  );

  // 正文防抖自动保存
  const onContentChange = useCallback(
    (md: string) => {
      setContent(md);
      contentRef.current = md;
      setSaveState("dirty");
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(async () => {
        if (md === savedContentRef.current) {
          setSaveState("idle");
          return;
        }
        if (await patch({ content: md })) {
          savedContentRef.current = md;
        }
      }, 2000);
    },
    [patch],
  );

  useEffect(() => {
    const forceSave = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      const latest = contentRef.current;
      if (latest === savedContentRef.current) return;
      void patch({ content: latest }).then((saved) => {
        if (saved) savedContentRef.current = latest;
      });
    };
    window.addEventListener(COMMAND_EVENTS.forceSave, forceSave);
    return () => window.removeEventListener(COMMAND_EVENTS.forceSave, forceSave);
  }, [patch]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  useEffect(() => {
    const root = document.querySelector(".note-detail");
    if (!root) return;
    root.querySelectorAll("h1,h2,h3").forEach((el) => el.setAttribute("data-heading-text", el.textContent?.trim() ?? ""));
  }, [content]);

  /* 目录高亮当前阅读位置。判据不用「第一个进入视口的标题」——正文滚过一段长
     内容时视口里可能一个标题都没有，高亮会闪回顶部。改为记住「最后一个越过
     视口上沿的标题」，即当前正在读的那一节。

     监听挂在 document 的捕获阶段而不是滚动容器上：编辑器是懒加载的，
     effect 首次运行时 [data-note-scroll] 还没挂上，而依赖只有 content，
     直接查容器会永远拿到 null，高亮从此不动。 */
  useEffect(() => {
    const pick = () => {
      const scroller = document.querySelector<HTMLElement>("[data-note-scroll]");
      if (!scroller) return;
      const nodes = [...scroller.querySelectorAll<HTMLElement>("h1,h2,h3")];
      if (nodes.length === 0) return setActiveHeading("");
      const top = scroller.getBoundingClientRect().top;
      // 容差 8px：标题正好卡在上沿时不该来回跳
      let current = nodes[0];
      for (const n of nodes) {
        if (n.getBoundingClientRect().top - top <= 8) current = n;
        else break;
      }
      setActiveHeading(current.textContent?.trim() ?? "");
    };
    pick();
    // 编辑器懒加载完成后补一次，否则首屏没有高亮
    const timer = setTimeout(pick, 400);
    // scroll 不冒泡，但捕获阶段能收到任意后代的滚动
    document.addEventListener("scroll", pick, true);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("scroll", pick, true);
    };
  }, [content]);

  async function saveTitle() {
    if (title !== note.title) {
      await patch({ title });
      router.refresh();
    }
  }

  async function changeTopic(id: string) {
    setTopicId(id);
    await patch({ topicId: id });
    router.refresh();
  }

  async function saveTags() {
    const newTags = tagsText.split(/[,，]/).map((t) => t.trim()).filter(Boolean);
    if (newTags.join("\n") !== initialTags.join("\n")) {
      await patch({ tags: newTags });
      router.refresh();
    }
  }

  async function remove() {
    setDeleting(true);
    try {
      const res = await fetch(`/api/notes/${note.id}`, { method: "DELETE" });
      if (res.ok) {
        router.replace("/");
        router.refresh();
      }
    } finally {
      setDeleting(false);
    }
  }

  async function reprocess() {
    await fetch(`/api/notes/${note.id}/reprocess`, { method: "POST" });
    router.refresh();
  }

  const statusText = AI_STATUS_TEXT[note.aiStatus];
  const transcriptionStatus = note.transcriptionReviewStatus;
  async function markTranscriptionReviewed() {
    if (await patch({ transcriptionReviewStatus: "reviewed" })) router.refresh();
  }
  async function handleCandidate(method: "POST" | "DELETE") {
    const res = await fetch(`/api/notes/${note.id}/transcription-candidate`, { method });
    if (res.ok) router.refresh();
  }
  const saveText = { idle: "", dirty: "输入中…", saving: "保存中…", saved: "已保存", error: "保存失败" }[saveState];

  return (
    <div className="flex h-[calc(100dvh-9rem)] flex-col md:h-[calc(100dvh-7.5rem)]">
      {/* 纸面化：整页一张白纸，元数据收进安静的工具行，标题正文裸排 */}
      <div className="flex min-h-0 flex-1 flex-col rounded-card bg-surface p-6 md:px-10 md:py-8">
        <div className="mb-5 flex items-center justify-between gap-2">
          <div className="flex min-w-0 flex-1 items-center gap-2.5">
            <BackButton fallback={backHref} iconOnly />
            <select
              value={topicId}
              onChange={(e) => changeTopic(e.target.value)}
              className="h-[32px] min-w-0 max-w-full rounded-utility border border-hairline bg-surface px-3 text-[13px] text-ink-80 outline-none focus:border-action-focus"
            >
              {topics.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.isSystem ? "未分类" : t.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex shrink-0 items-center gap-4">
            <span className={`text-[12px] ${saveState === "error" ? "text-danger" : "text-ink-48"}`}>
              {saveText}
            </span>
            <button
              onClick={() => setFocusMode((v) => !v)}
              className={`text-[12px] transition-colors active:scale-95 ${
                focusMode ? "text-action" : "text-ink-48 hover:text-action"
              }`}
              title={focusMode ? "退出专注模式" : "藏起工具栏、目录与标签，只留正文"}
            >
              {focusMode ? "退出专注" : "专注"}
            </button>
            <AskWithSourcesButton
              type="note"
              id={note.id}
              label={title || "（无标题笔记）"}
              className="text-[12px] text-ink-48 transition-colors hover:text-action active:scale-95"
            />
            <button
              onClick={() => setConfirmingDelete(true)}
              className="text-[12px] text-ink-48 transition-colors hover:text-danger active:scale-95"
            >
              删除
            </button>
          </div>
        </div>

        {statusText && (
          <p className="mb-3 flex items-center gap-2 text-[12px] text-ink-48">
            {statusText}
            {note.aiStatus === "failed" && (
              <button
                onClick={reprocess}
                className="rounded-chip border border-action px-3 py-0.5 text-[12px] text-action transition-transform active:scale-95"
              >
                重新处理
              </button>
            )}
          </p>
        )}

        {transcriptionStatus !== "reviewed" && (
          <div className="mb-3 border-l-2 border-action pl-3 text-[12px] text-ink-48">
            <div className="flex items-center gap-2">
              <span>{transcriptionStatus === "needs_review" ? "转写包含待核对告警" : "转写待核对"}</span>
              <button type="button" onClick={markTranscriptionReviewed} className="rounded-chip border border-action px-3 py-0.5 text-action">标记已核对</button>
            </div>
            {transcriptionWarnings.length > 0 && <ul className="mt-1 list-disc pl-4">{transcriptionWarnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>}
            {note.transcriptionCandidate && (
              <details className="mt-2">
                <summary className="cursor-pointer text-action">查看候选稿</summary>
                <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded-utility bg-fill p-2 text-[12px] text-ink-80">{note.transcriptionCandidate}</pre>
                <div className="mt-2 flex gap-2">
                  <button type="button" onClick={() => handleCandidate("POST")} className="rounded-utility bg-cta px-3 py-1 text-cta-ink">追加到正文</button>
                  <button type="button" onClick={() => handleCandidate("DELETE")} className="rounded-utility border border-hairline px-3 py-1">丢弃</button>
                </div>
              </details>
            )}
          </div>
        )}

        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={saveTitle}
          placeholder="标题（留空由 AI 生成）"
          className="mb-4 w-full bg-transparent font-serif text-[28px] tracking-[-0.374px] outline-none placeholder:text-ink-48/50"
        />
        <div className="flex min-h-0 flex-1 gap-8">
          {/* 必须是 flex 列容器：MarkdownEditor 根节点靠 flex-1 + min-h-0 把
              自己的滚动区限高，父层若是普通块级元素，它会长到内容高度并
              溢出到下方的标签行上 */}
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <MarkdownEditor
              value={content}
              onChange={onContentChange}
              noteId={note.id}
              hideToolbar={focusMode}
            />
          </div>
          {!focusMode && (
            <aside className="hidden w-[260px] shrink-0 overflow-y-auto border-l border-divider pl-5 lg:block">
              <p className="mb-3 text-[12px] font-medium text-ink-48">目录</p>
              {headings.length === 0 ? (
                <p className="text-[12px] text-ink-48">暂无标题</p>
              ) : (
                <nav className="space-y-0.5">
                  {headings.map((h) => {
                    // 按标题文本比对：目录项与正文锚点用的是同一套判据
                    const active = h.text === activeHeading;
                    return (
                      <button
                        key={h.id}
                        className={`block w-full truncate rounded-utility py-1 pr-2 text-left text-[13px] transition-colors ${
                          active
                            ? "bg-action/10 font-medium text-action"
                            : "text-ink-80 hover:bg-fill hover:text-action"
                        }`}
                        style={{ paddingLeft: 8 + (h.level - 1) * 12 }}
                        onClick={() =>
                          document
                            .querySelector(`[data-heading-text="${CSS.escape(h.text)}"]`)
                            ?.scrollIntoView({ behavior: "smooth", block: "start" })
                        }
                      >
                        {h.text}
                      </button>
                    );
                  })}
                </nav>
              )}
              <div className="mt-8 border-t border-divider pt-4">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <p className="text-[12px] font-medium text-ink-48">相关笔记</p>
                  {relatedLoading && <span className="text-[11px] text-ink-48">查找中…</span>}
                </div>
                {conflicts.length > 0 && (
                  <div className="mb-3 border-l-2 border-danger pl-2 text-[12px] text-danger">
                    <p className="mb-1 font-medium">可能存在冲突</p>
                    {conflicts.map((conflict) => <p key={conflict.noteId} className="mb-1">{conflict.reason}</p>)}
                  </div>
                )}
                {related.length === 0 && !relatedLoading ? (
                  <p className="text-[12px] text-ink-48">暂无相关笔记</p>
                ) : (
                  <div className="space-y-3">
                    {related.map((item) => (
                      <Link key={item.id} href={`/notes/${item.id}`} className="block rounded-utility p-2 transition-colors hover:bg-fill">
                        <p className="truncate text-[13px] text-ink-80">{item.title}</p>
                        <p className="mt-1 line-clamp-3 text-[12px] leading-5 text-ink-48">{item.excerpt}</p>
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            </aside>
          )}
        </div>
        {!focusMode && (
          <div className="mt-5 border-t border-divider pt-4">
            <input
              value={tagsText}
              onChange={(e) => setTagsText(e.target.value)}
              onBlur={saveTags}
              placeholder="标签，用逗号分隔（留空由 AI 生成）"
              className="w-full bg-transparent text-[14px] text-ink-80 outline-none placeholder:text-ink-48/60"
            />
          </div>
        )}
      </div>
      <ConfirmDialog
        open={confirmingDelete}
        title="把这条笔记移入回收站？"
        message="30 天内可在 设置 → 回收站 恢复"
        confirmText="移入"
        danger={false}
        busy={deleting}
        onConfirm={remove}
        onCancel={() => setConfirmingDelete(false)}
      />
    </div>
  );
}
