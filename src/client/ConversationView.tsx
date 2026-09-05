import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ConversationSnapshot, ConversationMessage, SessionFeedStatus, ThreadInfo } from "../shared/protocol";
import { readConversation, readDraft, readPosition, storeConversation, storeDraft, storePosition } from "./conversation-state";
import { attachTerminalViewport } from "./terminal-viewport";
import { readApiResponse, readConversationResponse } from "./conversation-api";
import { WorkingActivity } from "./WorkingActivity";
import { formatDuration } from "./working-duration";
import type { ThemeId } from "./theme";
import { useDictation } from "./use-dictation";
import { VoiceWaveform } from "./VoiceWaveform";

interface Props {
  hostUrl: string;
  transcriptionUrl: string;
  hostLabel: string;
  threadId: string;
  feedStatus: SessionFeedStatus;
  themeId: ThemeId;
  liveThread?: ThreadInfo;
  onHome(): void;
  onTerminal(): void;
}

/** Reads durable replies without acquiring terminal ownership. */
export function ConversationView({ hostUrl, transcriptionUrl, hostLabel, threadId, feedStatus, themeId, liveThread, onHome, onTerminal }: Props) {
  const [conversation, setConversation] = useState(() => readConversation(hostUrl, threadId));
  const [draft, setDraft] = useState(() => readDraft(hostUrl, threadId));
  const [sending, setSending] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [readError, setReadError] = useState<string>();
  const [following, setFollowing] = useState(true);
  const [draftSaved, setDraftSaved] = useState(true);
  const [actionsOpen, setActionsOpen] = useState(false);
  const root = useRef<HTMLElement>(null);
  const reader = useRef<HTMLDivElement>(null);
  const mounted = useRef(true);
  const followingRef = useRef(true);
  const initialized = useRef(false);
  const requestGeneration = useRef(0);
  const thread = liveThread ?? conversation?.thread;
  const live = feedStatus === "live";
  const active = live && Boolean(thread?.current_run);
  const working = active && thread?.current_run?.agent_status === "working";
  const agent = thread?.agent ? thread.agent.charAt(0).toUpperCase() + thread.agent.slice(1) : "Agent";
  const conversationReady = live && Boolean(conversation) && !readError;
  const receipt = conversation?.messages.find((message) => message.message_id === draft.messageId);
  const uncertain = receipt?.delivery === "uncertain";
  const pending = sending || receipt?.delivery === "sending";

  useEffect(() => {
    mounted.current = true;
    const detach = attachTerminalViewport(root.current!);
    return () => { mounted.current = false; requestGeneration.current++; detach(); };
  }, []);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    const generation = ++requestGeneration.current;
    try {
      const response = await fetch(`${hostUrl}/api/threads/${encodeURIComponent(threadId)}/conversation`, { signal: signal ?? AbortSignal.timeout(8000), cache: "no-store" });
      const body = await readConversationResponse(response, threadId);
      if (!mounted.current || generation !== requestGeneration.current) return;
      setReadError(undefined);
      setConversation((previous) => {
        const older = previous?.messages.filter((message) => message.sequence < (body.messages[0]?.sequence ?? 0)) ?? [];
        const next = { ...body, messages: [...older, ...body.messages], has_older: older.length ? previous!.has_older : body.has_older } as ConversationSnapshot;
        if (JSON.stringify(previous) === JSON.stringify(next)) return previous;
        storeConversation(hostUrl, threadId, next);
        return next;
      });
    } catch (error) {
      if (mounted.current && generation === requestGeneration.current && (!signal?.aborted || signal.reason?.name === "TimeoutError")) setReadError(error instanceof Error ? error.message : "Host unavailable");
    }
  }, [hostUrl, threadId]);

  useEffect(() => {
    let controller: AbortController | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    const poll = async () => {
      if (stopped || document.hidden) return;
      controller?.abort();
      controller = new AbortController();
      const current = controller;
      await refresh(AbortSignal.any([current.signal, AbortSignal.timeout(8000)]));
      if (!stopped && controller === current) timer = setTimeout(poll, 2500);
    };
    const resume = () => { clearTimeout(timer); controller?.abort(); void poll(); };
    void poll();
    window.addEventListener("online", resume);
    window.addEventListener("pageshow", resume);
    document.addEventListener("visibilitychange", resume);
    return () => { stopped = true; clearTimeout(timer); controller?.abort(); window.removeEventListener("online", resume); window.removeEventListener("pageshow", resume); document.removeEventListener("visibilitychange", resume); };
  }, [refresh]);

  useEffect(() => {
    if (receipt?.delivery !== "acknowledged" || !draft.text) return;
    const next = { text: "", messageId: crypto.randomUUID() };
    storeDraft(hostUrl, threadId, next);
    setDraft(next);
  }, [receipt?.delivery, draft.text, hostUrl, threadId]);

  useLayoutEffect(() => {
    const element = reader.current;
    if (!element || !conversation) return;
    if (!initialized.current) {
      const saved = readPosition(hostUrl, threadId);
      element.scrollTop = saved ?? element.scrollHeight;
      initialized.current = true;
      followingRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 60;
      setFollowing(followingRef.current);
    } else if (followingRef.current) element.scrollTop = element.scrollHeight;
  }, [conversation, hostUrl, threadId, working]);

  useEffect(() => {
    const element = reader.current!;
    // Keyboard and action-menu changes resize the reader without a new reply.
    const resize = new ResizeObserver(() => {
      if (followingRef.current) element.scrollTop = element.scrollHeight;
    });
    resize.observe(element);
    return () => resize.disconnect();
  }, []);

  const edit = (text: string) => {
    const next = { text, messageId: crypto.randomUUID() };
    setDraft(next);
    setDraftSaved(storeDraft(hostUrl, threadId, next));
    setError(undefined);
  };

  const send = async () => {
    if (!active || !conversationReady || pending || uncertain || dictation.busy || !draft.text.trim()) return;
    setSending(true);
    setError(undefined);
    // The draft and its ID are already durable before any request leaves the page.
    try {
      const response = await fetch(`${hostUrl}/api/threads/${encodeURIComponent(threadId)}/messages`, {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(15_000),
        body: JSON.stringify({ text: draft.text, message_id: draft.messageId, retry: receipt?.delivery === "failed" }),
      });
      const body = await readApiResponse(response);
      if (!body.message?.message_id || body.message.message_id !== draft.messageId) throw new Error("The host did not return a delivery receipt");
      if (!mounted.current) return;
      const message = body.message as ConversationMessage;
      setConversation((previous) => previous ? { ...previous, messages: [...previous.messages.filter((item) => item.message_id !== message.message_id), message].sort((a, b) => a.sequence - b.sequence) } : previous);
      if (message.delivery === "acknowledged") {
        const next = { text: "", messageId: crypto.randomUUID() };
        storeDraft(hostUrl, threadId, next); setDraft(next);
      }
      followingRef.current = true;
      await refresh();
    } catch {
      if (mounted.current) {
        setError("Delivery is being checked. Your draft is saved. Sending again uses the same receipt, so it will not repeat an accepted request.");
        await refresh();
      }
    } finally { if (mounted.current) setSending(false); }
  };

  const dictation = useDictation(transcriptionUrl, text => {
    edit(draft.text + (draft.text && !/\s$/.test(draft.text) ? " " : "") + text);
  });

  const action = async (kind: "archive" | "restore" | "stop") => {
    setActionsOpen(false);
    setBusy(true); setError(undefined);
    try {
      const response = await fetch(`${hostUrl}/api/threads/${encodeURIComponent(threadId)}/${kind}`, { method: "POST", signal: AbortSignal.timeout(70_000) });
      const body = await readApiResponse(response);
      if (body.outcome === "retained") setError("Herdr kept this process running to preserve its worktree. You can inspect it in the terminal.");
      await refresh();
    } catch (error) { if (mounted.current) setError(error instanceof Error ? error.message : "Action failed"); }
    finally { if (mounted.current) setBusy(false); }
  };

  const older = async () => {
    if (!conversation?.messages.length) return;
    const element = reader.current!;
    const height = element.scrollHeight;
    try {
      const response = await fetch(`${hostUrl}/api/threads/${encodeURIComponent(threadId)}/conversation?before=${conversation.messages[0].sequence}`, { signal: AbortSignal.timeout(8000) });
      const body = await readConversationResponse(response, threadId);
      followingRef.current = false;
      setConversation((previous) => previous ? { ...previous, messages: [...body.messages, ...previous.messages.filter((item) => !body.messages.some((old) => old.message_id === item.message_id))], has_older: body.has_older } : body);
      requestAnimationFrame(() => { element.scrollTop += element.scrollHeight - height; });
    } catch (error) { setError((error as Error).message); }
  };

  return <main className="conversation-screen" ref={root}>
    <header className="conversation-header">
      <button className="secondary icon-button conversation-home" aria-label="Home" title="Home" onClick={onHome}><svg viewBox="0 0 24 24"><path d="m14 6-6 6 6 6" /></svg></button>
      <div className="conversation-heading"><h1>{thread?.title ?? "Conversation"}</h1><small><span className={`conversation-connection ${live ? "live" : "stale"}`} aria-hidden="true" />{hostLabel} · {live ? `Live · ${thread?.current_run ? thread.current_run.agent_status ?? "Agent available" : "Stopped"}${readError ? " · History unavailable" : ""}` : "Reconnecting · saved history"}</small></div>
      <button className="secondary icon-button" aria-label="Open terminal" title="Open terminal" disabled={!active} onClick={onTerminal}><svg viewBox="0 0 24 24"><path d="m5 7 5 5-5 5m8 0h6" /></svg></button>
      <button className="secondary icon-button" aria-label="Thread actions" title="Thread actions" aria-expanded={actionsOpen} aria-controls="conversation-actions" onClick={() => setActionsOpen(!actionsOpen)}><svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></svg></button>
    </header>
    {actionsOpen && <div className="conversation-toolbar" id="conversation-actions" onKeyDown={(event) => { if (event.key === "Escape") { setActionsOpen(false); root.current?.querySelector<HTMLButtonElement>('[aria-controls="conversation-actions"]')?.focus(); } }}>
      <span>{agent}{thread?.lifecycle === "archived" ? " · Archived" : ""}</span>
      {thread && <button className="secondary" disabled={!conversationReady || busy} onClick={() => void action(thread.lifecycle === "archived" && thread.current_run ? "restore" : "archive")}>{thread.lifecycle === "archived" && thread.current_run ? "Unarchive" : "Archive"}</button>}
      {active && <button className="secondary" disabled={!conversationReady || busy} onClick={() => { if (window.confirm("Stop this agent process? Its conversation history will remain available.")) void action("stop"); }}>Stop agent</button>}
      {!thread?.current_run && thread?.agent_session && <button disabled={!conversationReady || busy || thread.restoring} onClick={() => void action("restore")}>{busy || thread.restoring ? "Resuming…" : "Resume agent"}</button>}
    </div>}
    <div className="conversation-reader" ref={reader} onScroll={() => {
      const element = reader.current!;
      followingRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 60;
      setFollowing(followingRef.current);
      storePosition(hostUrl, threadId, element.scrollTop);
    }}>
      <div className="conversation-messages">
        {conversation?.has_older && <button className="secondary" onClick={() => void older()}>Load earlier messages</button>}
        {!conversation && <p className="notice">{readError ?? "Loading conversation…"}</p>}
        {conversation && !conversation.capture_available && <p className="conversation-notice">No agent messages captured yet. New replies appear after a response finishes in a session with reply capture enabled. Earlier replies are not imported.</p>}
        {conversation?.messages.map((message) => <article className={`conversation-message ${message.role}`} key={message.message_id}>
          <header><strong>{message.role === "user" ? "You" : agent}</strong><time dateTime={message.created_at} title={new Date(message.created_at).toLocaleString()}>{new Date(message.created_at).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" })}</time>{message.delivery && <span className={`delivery ${message.delivery}`}>{message.delivery === "acknowledged" ? "Sent" : message.delivery === "uncertain" ? "Delivery uncertain" : message.delivery}</span>}</header>
          <MessageBody text={message.text} />
          {message.error && <p className="message-error">{message.error}</p>}
        </article>)}
        {active && thread?.current_run?.agent_status === "blocked" && <p className="conversation-notice">The agent needs input. Open the terminal to answer its interactive question.</p>}
        {thread && !thread.current_run && !thread.agent_session && <p className="conversation-notice">This agent has stopped and has no resume reference. Your conversation remains readable.</p>}
      </div>
    </div>
    <form className={`conversation-composer ${dictation.available ? "voice-enabled" : ""} ${!draft.text.trim() ? "draft-empty" : ""} ${dictation.busy ? "voice-busy" : ""}`} onSubmit={(event) => { event.preventDefault(); void send(); }}>
      {!following && <button type="button" className="jump-latest secondary" onClick={() => { followingRef.current = true; reader.current!.scrollTop = reader.current!.scrollHeight; setFollowing(true); }}>Jump to latest ↓</button>}
      {working && <ConversationWorking agent={agent} startedAt={thread.current_run?.working_started_at} themeId={themeId} />}
      {(error || readError || uncertain || dictation.error) && <p className="message-error" role="status">{uncertain ? receipt.error : error ?? readError ?? dictation.error}</p>}
      <div className="conversation-input">
      {dictation.stream && <div className="voice-feedback"><VoiceWaveform stream={dictation.stream} /></div>}
      <label htmlFor="conversation-draft" className="sr-only">Message</label>
      <textarea id="conversation-draft" value={draft.text} onChange={(event) => edit(event.target.value)} disabled={pending} placeholder={dictation.available ? "Type a message…" : active ? `Message ${agent}…` : "Write a draft…"} rows={2} onKeyDown={(event) => { if (event.key === "Enter" && !event.nativeEvent.isComposing && (event.ctrlKey || event.metaKey)) { event.preventDefault(); void send(); } }} />
      <footer><small role={dictation.busy ? "status" : undefined}>{dictation.phase === "starting" ? "Waiting for microphone…" : dictation.phase === "recording" ? `Recording · ${dictation.seconds}s / 120s` : dictation.phase === "transcribing" ? "Transcribing…" : draft.text ? draftSaved ? "Draft saved on this device" : "Device storage unavailable · keep this page open" : working ? "You can write while it works" : active ? `Connected to ${agent}` : "Drafts stay on this device"}</small>
        <div className="composer-buttons">
          {dictation.busy && <button type="button" className="secondary dictation-cancel" onClick={dictation.cancel}>Cancel</button>}
          {dictation.available && <button type="button" className={`secondary dictation-mic ${dictation.phase === "recording" ? "recording" : ""}`} disabled={pending || dictation.phase === "starting" || dictation.phase === "transcribing"} aria-label={dictation.phase === "recording" ? "Stop recording" : "Dictate message"} title={dictation.phase === "recording" ? "Stop and transcribe" : "Dictate message"} onClick={() => dictation.phase === "recording" ? dictation.stop() : void dictation.start()}>
            <svg viewBox="0 0 24 24" aria-hidden="true">{dictation.phase === "recording" ? <rect x="6" y="6" width="12" height="12" rx="2" /> : <><rect x="9" y="3" width="6" height="12" rx="3" /><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3m-4 0h8" /></>}</svg>
            <span className="dictation-button-label">{dictation.phase === "recording" ? "Finish" : draft.text.trim() ? "Add voice" : "Tap to speak"}</span>
          </button>}
          <button className="conversation-send" disabled={!active || !conversationReady || pending || uncertain || dictation.busy || !draft.text.trim()}>{pending ? "Sending…" : receipt?.delivery === "failed" ? "Retry" : "Send"}<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5m-6 6 6-6 6 6" /></svg></button>
        </div>
      </footer>
      </div>
    </form>
  </main>;
}

/** Keep animation and elapsed-time updates independent of the transcript. */
function ConversationWorking({ agent, startedAt, themeId }: { agent: string; startedAt?: string; themeId: ThemeId }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!startedAt) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [startedAt]);
  const elapsed = startedAt ? now - Date.parse(startedAt) : undefined;
  return <div className="conversation-working">
    <WorkingActivity themeId={themeId} />
    <span className="conversation-working-beacon" aria-hidden="true" />
    <div className="conversation-working-copy"><span role="status">{agent} is working<span className="working-ellipsis" aria-hidden="true"><i /><i /><i /></span></span><small>The reply will appear when it’s ready</small></div>
    {elapsed !== undefined && Number.isFinite(elapsed) && <span className="conversation-working-time" aria-label="Time working">{formatDuration(Math.max(0, elapsed))}</span>}
  </div>;
}

// Typing and status updates should not reparse the entire conversation's Markdown.
const MessageBody = memo(function MessageBody({ text }: { text: string }) {
  return <div className="message-markdown"><Markdown remarkPlugins={[remarkGfm]} components={{ a: ({ children, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer">{children}</a> }}>{text}</Markdown></div>;
});
