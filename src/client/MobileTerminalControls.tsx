import { useEffect, useRef, useState } from "react";

const MOBILE_INPUT_QUERY = "(pointer: coarse)";

interface Props {
  terminalActive: boolean;
  messageAvailable: boolean;
  paneLabel: string;
  onFocusTerminal: () => void;
  onKey: (data: string) => boolean;
  onSendMessage: (text: string) => Promise<void>;
}

const KEYS: ReadonlyArray<{ label: string; key: string; name?: string }> = [
  { label: "Esc", key: "esc" },
  { label: "Tab", key: "tab" },
  { label: "^C", key: "ctrl+c", name: "Ctrl+C" },
  { label: "←", key: "left", name: "Left arrow" },
  { label: "↑", key: "up", name: "Up arrow" },
  { label: "↓", key: "down", name: "Down arrow" },
  { label: "→", key: "right", name: "Right arrow" },
];

export function MobileTerminalControls({
  terminalActive,
  messageAvailable,
  paneLabel,
  onFocusTerminal,
  onKey,
  onSendMessage,
}: Props) {
  const mobile = useMediaQuery(MOBILE_INPUT_QUERY);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [keysOpen, setKeysOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string>();

  useEffect(() => {
    if (composerOpen) textareaRef.current?.focus();
  }, [composerOpen]);

  if (!mobile) return null;

  const send = async () => {
    if (!messageAvailable || sending || draft.trim().length === 0) return;
    setSending(true);
    setSendError(undefined);
    try {
      await onSendMessage(draft);
      setDraft("");
      setComposerOpen(false);
    } catch (error) {
      setSendError(error instanceof Error ? error.message : "Message failed");
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <nav className="mobile-terminal-controls" aria-label="Terminal controls">
        <button className="message-trigger" onClick={() => {
          setKeysOpen(false);
          setComposerOpen(true);
        }} disabled={!messageAvailable}>
          Message
        </button>
        <button className="terminal-key menu-trigger" onClick={() => {
          setComposerOpen(false);
          setKeysOpen(true);
        }} disabled={!terminalActive}>Keys</button>
        <button className="terminal-key" aria-label="Open direct keyboard" onClick={onFocusTerminal} disabled={!terminalActive}>
          ⌨
        </button>
      </nav>

      {keysOpen && (
        <div className="message-backdrop" onPointerDown={(event) => {
          if (event.target === event.currentTarget) setKeysOpen(false);
        }}>
          <section className="message-composer terminal-key-sheet" role="dialog" aria-modal="true" aria-labelledby="terminal-keys-title">
            <header>
              <div>
                <h2 id="terminal-keys-title">Terminal keys</h2>
                <small>{terminalActive ? `Connected to ${paneLabel}` : "Terminal control unavailable"}</small>
              </div>
              <button className="secondary icon-button" onClick={() => setKeysOpen(false)} aria-label="Close terminal keys">×</button>
            </header>
            <div className="terminal-key-grid">
              {KEYS.map((key) => (
                <button
                  className="terminal-key"
                  key={key.label}
                  aria-label={key.name ?? key.label}
                  onClick={() => onKey(key.key)}
                  disabled={!terminalActive}
                >
                  {key.label}
                </button>
              ))}
            </div>
          </section>
        </div>
      )}

      {composerOpen && (
        <div className="message-backdrop" onPointerDown={(event) => {
          if (event.target === event.currentTarget) setComposerOpen(false);
        }}>
          <section className="message-composer message-sheet" role="dialog" aria-modal="true" aria-labelledby="message-title">
            <span className="message-sheet-handle" aria-hidden="true" />
            <header>
              <div>
                <h2 id="message-title">Send message</h2>
                <small className="message-destination">
                  <span className={`message-connection-dot ${messageAvailable ? "connected" : ""}`} aria-hidden="true" />
                  {messageAvailable ? `Sending to ${paneLabel}` : "No active Thread"}
                </small>
              </div>
              <button className="secondary icon-button" onClick={() => setComposerOpen(false)} aria-label="Close message composer">×</button>
            </header>
            <label className="message-field">
              <span className="message-field-label">Message</span>
              <textarea
                ref={textareaRef}
                value={draft}
                onChange={(event) => {
                  setDraft(event.target.value);
                  setSendError(undefined);
                }}
                disabled={sending}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                    event.preventDefault();
                    send();
                  }
                }}
                placeholder="Prepare a message locally…"
                rows={7}
              />
            </label>
            {sendError && <p className="notice error" role="alert">{sendError}</p>}
            <footer>
              <small><kbd>Ctrl</kbd><span>/</span><kbd>⌘</kbd><span>+</span><kbd>Enter</kbd></small>
              <button onClick={() => void send()} disabled={!messageAvailable || sending || draft.trim().length === 0}>
                {sending ? "Sending…" : sendError ? "Retry" : "Send"}
              </button>
            </footer>
          </section>
        </div>
      )}
    </>
  );
}

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);

  useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [query]);

  return matches;
}
