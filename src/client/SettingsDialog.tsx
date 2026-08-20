import { useEffect, useRef, useState, type FormEvent } from "react";
import { AGENT_KINDS } from "./agent-catalog";
import { DEFAULT_SETTINGS, type AppSettings } from "./settings";
import { isThemeId, themeOptions } from "./theme";

export function SettingsDialog({
  settings,
  onCancel,
  onSave,
}: {
  settings: AppSettings;
  onCancel(): void;
  onSave(settings: AppSettings): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState(settings);

  useEffect(() => {
    dialog.current?.showModal();
    return () => dialog.current?.close();
  }, []);

  function submit(event: FormEvent) {
    event.preventDefault();
    onSave({
      ...draft,
      interfaceFontFamily: draft.interfaceFontFamily.trim(),
      terminalFontFamily: draft.terminalFontFamily.trim(),
    });
  }

  return (
    <dialog
      ref={dialog}
      className="action-dialog settings-dialog"
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
    >
      <form onSubmit={submit}>
        <div className="action-dialog-content">
          <span className="action-dialog-icon settings" aria-hidden="true"><SettingsIcon /></span>
          <div>
            <h2>Settings</h2>
            <p>Choose your appearance and defaults for new threads.</p>
          </div>
        </div>

        <div className="settings-sections">
          <fieldset>
            <legend>New threads</legend>
            <div className="settings-fields">
              <label>
                <span>Default agent</span>
                <select
                  value={draft.defaultAgent}
                  onChange={(event) => setDraft({ ...draft, defaultAgent: event.target.value })}
                >
                  {!AGENT_KINDS.some(({ kind }) => kind === draft.defaultAgent) && (
                    <option value={draft.defaultAgent}>{draft.defaultAgent}</option>
                  )}
                  {AGENT_KINDS.map((agent) => (
                    <option value={agent.kind} key={agent.kind}>{agent.label}</option>
                  ))}
                </select>
              </label>
              <label className="settings-toggle">
                <input
                  type="checkbox"
                  checked={draft.defaultSkipPermissions}
                  onChange={(event) => setDraft({ ...draft, defaultSkipPermissions: event.target.checked })}
                />
                <span>
                  <strong>Skip permission prompts by default</strong>
                  <small>Uses the selected agent's configured permission-bypass mode. You can override this per thread.</small>
                </span>
              </label>
            </div>
          </fieldset>

          <fieldset>
            <legend>Appearance</legend>
            <div className="settings-fields">
              <label>
                <span>Theme</span>
                <select
                  value={draft.theme}
                  onChange={(event) => {
                    if (isThemeId(event.target.value)) setDraft({ ...draft, theme: event.target.value });
                  }}
                >
                  {themeOptions.map((option) => (
                    <option key={option.id} value={option.id}>{option.label}</option>
                  ))}
                </select>
              </label>
              <label>
                <span>App font</span>
                <input
                  required
                  maxLength={200}
                  value={draft.interfaceFontFamily}
                  onChange={(event) => setDraft({ ...draft, interfaceFontFamily: event.target.value })}
                />
              </label>
              <label>
                <span>App text size</span>
                <span className="settings-number">
                  <input
                    aria-label="App text size"
                    type="number"
                    min={13}
                    max={20}
                    required
                    value={draft.interfaceFontSize}
                    onChange={(event) => {
                      if (Number.isFinite(event.target.valueAsNumber)) {
                        setDraft({ ...draft, interfaceFontSize: event.target.valueAsNumber });
                      }
                    }}
                  />
                  <small>px</small>
                </span>
              </label>
              <label>
                <span>Terminal font</span>
                <input
                  required
                  maxLength={200}
                  value={draft.terminalFontFamily}
                  onChange={(event) => setDraft({ ...draft, terminalFontFamily: event.target.value })}
                />
              </label>
              <label>
                <span>Terminal text size</span>
                <span className="settings-number">
                  <input
                    aria-label="Terminal text size"
                    type="number"
                    min={10}
                    max={32}
                    required
                    value={draft.terminalFontSize}
                    onChange={(event) => {
                      if (Number.isFinite(event.target.valueAsNumber)) {
                        setDraft({ ...draft, terminalFontSize: event.target.valueAsNumber });
                      }
                    }}
                  />
                  <small>px</small>
                </span>
              </label>
              <label className="settings-toggle compact">
                <input
                  type="checkbox"
                  checked={draft.terminalCursorBlink}
                  onChange={(event) => setDraft({ ...draft, terminalCursorBlink: event.target.checked })}
                />
                <span><strong>Blink terminal cursor</strong></span>
              </label>
            </div>
          </fieldset>
        </div>

        <footer className="settings-footer">
          <button className="secondary settings-reset" type="button" onClick={() => setDraft(DEFAULT_SETTINGS)}>
            Reset defaults
          </button>
          <span />
          <button className="secondary" type="button" onClick={onCancel}>Cancel</button>
          <button type="submit">Save</button>
        </footer>
      </form>
    </dialog>
  );
}

export function SettingsIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <path d="M9.7 3.8 10.3 2h3.4l.6 1.8 1.7 1 1.9-.4 1.7 2.9-1.3 1.4v2l1.3 1.4-1.7 2.9-1.9-.4-1.7 1-.6 1.8h-3.4l-.6-1.8-1.7-1-1.9.4-1.7-2.9 1.3-1.4v-2L4.4 7.3l1.7-2.9 1.9.4 1.7-1Z" />
      <circle cx="12" cy="10.7" r="3" />
    </svg>
  );
}
