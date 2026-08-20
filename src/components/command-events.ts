export const COMMAND_EVENTS = {
  toggleChat: "zhiliao:command-toggle-chat",
  toggleNav: "zhiliao:command-toggle-nav",
  forceSave: "zhiliao:command-force-save",
  submitChat: "zhiliao:command-submit-chat",
} as const;

export type CommandEventName = (typeof COMMAND_EVENTS)[keyof typeof COMMAND_EVENTS];

export function dispatchCommand(name: CommandEventName) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(name));
}

export function isEditableTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && Boolean(
    target.closest("input, textarea, select, [contenteditable='true']"),
  );
}
