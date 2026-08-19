"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { BackButton } from "@/components/back-button";

interface TopicOption {
  id: string;
  name: string;
  isSystem: number;
}

// 极简新建：正文优先，主题默认“让 AI 决定”
export function NewNoteForm({
  topics,
  defaultTopicId,
}: {
  topics: TopicOption[];
  defaultTopicId?: string;
}) {
  const router = useRouter();
  const [content, setContent] = useState("");
  const [topicId, setTopicId] = useState(defaultTopicId ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [transcribing, setTranscribing] = useState(false);

  async function captureHandwriting(file: File) {
    setTranscribing(true); setError("");
    try {
      const form = new FormData(); form.append("file", file);
      const upload = await fetch("/api/uploads", { method: "POST", body: form });
      const uploaded = await upload.json();
      if (!upload.ok) throw new Error(uploaded.error || "图片上传失败");
      const filename = String(uploaded.url).split("/").pop();
      const res = await fetch("/api/handwriting", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ filename, topicId: topicId || undefined }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "转写任务提交失败");
      router.replace(`/notes/${data.id}`); router.refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "手写转写失败"); setTranscribing(false); }
  }

  async function save() {
    if (!content.trim()) return;
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, topicId: topicId || undefined }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "保存失败");
        setSaving(false);
        return;
      }
      router.replace(topicId ? `/topics/${topicId}` : "/");
      router.refresh();
    } catch {
      setError("网络错误，笔记未保存");
      setSaving(false);
    }
  }

  return (
    <div className="flex h-[calc(100dvh-9rem)] flex-col md:h-[calc(100dvh-7.5rem)]">
      {/* 纸面化：白纸卡 + 顶部安静工具行 + 无框正文 */}
      <div className="flex min-h-0 flex-1 flex-col rounded-[18px] bg-surface p-6 md:px-10 md:py-8">
        <div className="mb-5 flex items-center justify-between gap-3">
          <div className="flex min-w-0 flex-1 items-center gap-2.5">
            <BackButton fallback="/" iconOnly />
            <select
              value={topicId}
              onChange={(e) => setTopicId(e.target.value)}
              className="h-[32px] min-w-0 max-w-full rounded-full border border-hairline bg-surface px-3 text-[13px] text-ink-80 outline-none focus:border-action-focus"
            >
              <option value="">让 AI 决定主题</option>
              {topics
                .filter((t) => !t.isSystem)
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
            </select>
          </div>
          <button
            onClick={save}
            disabled={saving || !content.trim()}
            className="shrink-0 rounded-full bg-action px-[22px] py-[8px] text-[14px] text-white transition-transform active:scale-95 disabled:opacity-40"
          >
            {saving ? "保存中…" : "保存"}
          </button>
          <label className="shrink-0 cursor-pointer rounded-full border border-hairline px-3 py-[7px] text-[13px] text-ink-80">
            {transcribing ? "转写中" : "手写摄取"}
            <input type="file" accept="image/*" className="hidden" disabled={transcribing} onChange={(e) => { const file = e.target.files?.[0]; if (file) void captureHandwriting(file); e.target.value = ""; }} />
          </label>
        </div>
        {error && <p className="mb-2 text-[14px] text-danger">{error}</p>}
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="随手记点什么……保存后 AI 会自动起标题、打标签、归入主题"
          autoFocus
          className="w-full flex-1 resize-none bg-transparent text-[17px] leading-[1.47] outline-none placeholder:text-ink-48/60"
        />
      </div>
    </div>
  );
}
