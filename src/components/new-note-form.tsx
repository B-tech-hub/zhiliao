"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { BackButton } from "@/components/back-button";

interface TopicOption {
  id: string;
  name: string;
  isSystem: number;
}

// 「已保存」停留的时长：够看清，又不至于挡住下一步
const SAVED_FLASH_MS = 700;

/* 极简新建：正文优先，主题默认"让 AI 决定"。
   两种形态共用这一份：整页 /notes/new，以及 QuickCapture 的就地浮层。
   判据是 onClose——给了就是浮层：保存后不跳转、返回钮换成关闭钮、高度交给浮层容器。 */
export function NewNoteForm({
  topics,
  defaultTopicId,
  onClose,
  draft,
  onDraftChange,
}: {
  topics: TopicOption[];
  defaultTopicId?: string;
  onClose?: () => void;
  /* 浮层关掉时表单会卸载，正文若只存在组件内部就跟着没了。
     由浮层托管这份草稿，误触关闭不丢字；整页形态两个都不传，行为与从前一致。 */
  draft?: string;
  onDraftChange?: (value: string) => void;
}) {
  const router = useRouter();
  const overlay = Boolean(onClose);
  const [ownContent, setOwnContent] = useState("");
  const content = draft ?? ownContent;
  const setContent = onDraftChange ?? setOwnContent;
  const [topicId, setTopicId] = useState(defaultTopicId ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [transcribing, setTranscribing] = useState(false);

  /* 浮层里保存成功不跳转，界面本来毫无变化——在 /settings 这类页面记一条
     会像是没保存。先把「已保存」亮出来，再收起浮层并清掉草稿。 */
  useEffect(() => {
    if (!saved) return;
    const timer = window.setTimeout(() => {
      setContent("");
      onClose?.();
    }, SAVED_FLASH_MS);
    return () => window.clearTimeout(timer);
  }, [saved, onClose, setContent]);

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
      // 转写完要去看结果，这一跳两种形态都对；浮层还得顺手收起，否则会盖住刚打开的笔记页
      router.replace(`/notes/${data.id}`); router.refresh(); onClose?.();
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
      if (overlay) {
        // 浮层是「就地捕获」，不该把用户从当前页面弹走：列表原地刷新即可
        setSaved(true);
        router.refresh();
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
    <div
      className={
        overlay
          ? "flex min-h-0 flex-1 flex-col"
          : "flex h-[calc(100dvh-9rem)] flex-col md:h-[calc(100dvh-7.5rem)]"
      }
    >
      {/* 纸面化：白纸卡 + 顶部安静工具行 + 无框正文 */}
      <div className="flex min-h-0 flex-1 flex-col rounded-card bg-surface p-6 md:px-10 md:py-8">
        <div className="mb-5 flex items-center justify-between gap-3">
          <div className="flex min-w-0 flex-1 items-center gap-2.5">
            {onClose ? (
              <button
                type="button"
                onClick={onClose}
                aria-label="关闭"
                className="flex shrink-0 items-center rounded-utility px-1.5 py-1 text-[14px] text-ink-48 transition-colors hover:bg-fill active:scale-95"
              >
                ✕
              </button>
            ) : (
              <BackButton fallback="/" iconOnly />
            )}
            <select
              value={topicId}
              onChange={(e) => setTopicId(e.target.value)}
              aria-label="归入主题"
              className="h-[32px] min-w-0 max-w-full rounded-utility border border-hairline bg-surface px-3 text-[13px] text-ink-80 outline-none focus:border-action-focus"
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
            className="shrink-0 rounded-utility bg-cta px-[22px] py-[8px] text-[14px] text-cta-ink transition-transform active:scale-95 disabled:opacity-40"
          >
            {saved ? "已保存" : saving ? "保存中…" : "保存"}
          </button>
          <label className="shrink-0 cursor-pointer rounded-utility border border-hairline px-3 py-[7px] text-[13px] text-ink-80">
            {transcribing ? "转写中" : "手写摄取"}
            <input type="file" accept="image/*" className="hidden" disabled={transcribing} onChange={(e) => { const file = e.target.files?.[0]; if (file) void captureHandwriting(file); e.target.value = ""; }} />
          </label>
        </div>
        {error && <p className="mb-2 text-[14px] text-danger">{error}</p>}
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="随手记点什么……保存后 AI 会自动起标题、打标签、归入主题"
          aria-label="笔记正文"
          autoFocus
          className="w-full flex-1 resize-none bg-transparent text-[17px] leading-[1.47] outline-none placeholder:text-ink-48/60"
        />
      </div>
    </div>
  );
}
