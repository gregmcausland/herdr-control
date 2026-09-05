import { useEffect, useState } from "react";

const MOBILE_INPUT_QUERY = "(pointer: coarse)";

interface Props {
  terminalActive: boolean;
  paneLabel: string;
  onFocusTerminal: () => void;
  onKey: (data: string) => boolean;
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
  paneLabel,
  onFocusTerminal,
  onKey,
}: Props) {
  const mobile = useMediaQuery(MOBILE_INPUT_QUERY);
  const [keysOpen, setKeysOpen] = useState(false);
  if (!mobile) return null;

  return (
    <>
      <nav className="mobile-terminal-controls" aria-label="Terminal controls">
        <button className="terminal-key menu-trigger" onClick={() => {
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
