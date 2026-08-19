import { useEffect, useRef, useState } from "react";

const MOBILE_INPUT_QUERY = "(pointer: coarse)";

interface Props {
  active: boolean;
  paneLabel: string;
  onFocusTerminal: () => void;
  onKey: (data: string) => boolean;
  onSendMessage: (text: string) => boolean;
}

const KEYS: ReadonlyArray<{ label: string; value: string; name?: string }> = [
  { label: "Esc", value: "\x1b" },
  { label: "Tab", value: "\t" },
  { label: "^C", value: "\x03", name: "Ctrl+C" },
  { label: "←", value: "\x1b[D", name: "Left arrow" },
  { label: "↑", value: "\x1b[A", name: "Up arrow" },
  { label: "↓", value: "\x1b[B", name: "Down arrow" },
  { label: "→", value: "\x1b[C", name: "Right arrow" },
];

export function MobileTerminalControls({ active, paneLabel, onFocusTerminal, onKey, onSendMessage }: Props) {
  const mobile = useMediaQuery(MOBILE_INPUT_QUERY);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [keysOpen, setKeysOpen] = useState(false);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    if (composerOpen) textareaRef.current?.focus();
  }, [composerOpen]);

  if (!mobile) return null;

  const send = () => {
    if (!onSendMessage(draft)) return;
    setDraft("");
    setComposerOpen(false);
  };

  return (
    <>
      <nav className="mobile-terminal-controls" aria-label="Terminal controls">
        <button className="message-trigger" onClick={() => {
          setKeysOpen(false);
          setComposerOpen(true);
        }} disabled={!active}>
          Message
        </button>
        <button className="terminal-key menu-trigger" onClick={() => {
          setComposerOpen(false);
          setKeysOpen(true);
        }} disabled={!active}>Keys</button>
        <button className="terminal-key" aria-label="Open direct keyboard" onClick={onFocusTerminal} disabled={!active}>
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
                <small>{active ? `Connected to ${paneLabel}` : "Terminal control unavailable"}</small>
              </div>
              <button className="secondary" onClick={() => setKeysOpen(false)} aria-label="Close terminal keys">×</button>
            </header>
            <div className="terminal-key-grid">
              {KEYS.map((key) => (
                <button
                  className="terminal-key"
                  key={key.label}
                  aria-label={key.name ?? key.label}
                  onClick={() => onKey(key.value)}
                  disabled={!active}
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
          <section className="message-composer" role="dialog" aria-modal="true" aria-labelledby="message-title">
            <header>
              <div>
                <h2 id="message-title">Send message</h2>
                <small>{active ? `Connected to ${paneLabel}` : "Terminal control unavailable"}</small>
              </div>
              <button className="secondary" onClick={() => setComposerOpen(false)} aria-label="Close message composer">×</button>
            </header>
            <textarea
              ref={textareaRef}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault();
                  send();
                }
              }}
              placeholder="Prepare a message locally…"
              rows={7}
            />
            <footer>
              <small>Ctrl/⌘ + Enter to send</small>
              <button onClick={send} disabled={!active || draft.trim().length === 0}>Send</button>
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
