"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Note } from "@/db/schema";
import { BackButton } from "@/components/back-button";
import { AskWithSourcesButton } from "@/components/chat/ask-with-sources";
import { ConfirmDialog } from "@/components/confirm-dialog";

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
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedContentRef = useRef(note.content);

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
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

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
  const saveText = { idle: "", dirty: "输入中…", saving: "保存中…", saved: "已保存", error: "保存失败" }[saveState];

  return (
    <div className="flex h-[calc(100dvh-9rem)] flex-col md:h-[calc(100dvh-7.5rem)]">
      {/* 纸面化：整页一张白纸，元数据收进安静的工具行，标题正文裸排 */}
      <div className="flex min-h-0 flex-1 flex-col rounded-[18px] bg-surface p-6 md:px-10 md:py-8">
        <div className="mb-5 flex items-center justify-between gap-2">
          <div className="flex min-w-0 flex-1 items-center gap-2.5">
            <BackButton fallback={backHref} iconOnly />
            <select
              value={topicId}
              onChange={(e) => changeTopic(e.target.value)}
              className="h-[32px] min-w-0 max-w-full rounded-full border border-hairline bg-surface px-3 text-[13px] text-ink-80 outline-none focus:border-action-focus"
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
                className="rounded-full border border-action px-3 py-0.5 text-[12px] text-action transition-transform active:scale-95"
              >
                重新处理
              </button>
            )}
          </p>
        )}

        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={saveTitle}
          placeholder="标题（留空由 AI 生成）"
          className="mb-4 w-full bg-transparent text-[28px] font-semibold tracking-[-0.374px] outline-none placeholder:text-ink-48/50"
        />
        <MarkdownEditor value={content} onChange={onContentChange} noteId={note.id} />
        <div className="mt-5 border-t border-divider pt-4">
          <input
            value={tagsText}
            onChange={(e) => setTagsText(e.target.value)}
            onBlur={saveTags}
            placeholder="标签，用逗号分隔（留空由 AI 生成）"
            className="w-full bg-transparent text-[14px] text-ink-80 outline-none placeholder:text-ink-48/60"
          />
        </div>
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
