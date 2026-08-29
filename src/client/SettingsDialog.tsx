import { useState, type FormEvent } from "react";
import type { AgentDefinition } from "../shared/agents";
import { DEFAULT_SETTINGS, type AppSettings } from "./settings";
import { TaskSurface } from "./Surface";
import { isThemeId, themeOptions } from "./theme";

export function SettingsDialog({
  settings,
  availableAgents,
  onCancel,
  onSave,
}: {
  settings: AppSettings;
  availableAgents: readonly AgentDefinition[];
  onCancel(): void;
  onSave(settings: AppSettings): void;
}) {
  const [draft, setDraft] = useState(settings);

  function submit(event: FormEvent) {
    event.preventDefault();
    onSave({
      ...draft,
      interfaceFontFamily: draft.interfaceFontFamily.trim(),
      terminalFontFamily: draft.terminalFontFamily.trim(),
    });
  }

  return (
    <TaskSurface
      title="Settings"
      description="Appearance and defaults for new threads."
      className="settings-dialog"
      onClose={onCancel}
      onSubmit={submit}
      actions={
        <>
          <button className="surface-button secondary settings-reset" type="button" onClick={() => setDraft(DEFAULT_SETTINGS)}>
            Reset defaults
          </button>
          <span className="surface-action-spacer" />
          <button className="surface-button secondary" type="button" onClick={onCancel}>Cancel</button>
          <button className="surface-button primary" type="submit">Save</button>
        </>
      }
    >
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
                  {!availableAgents.some(({ kind }) => kind === draft.defaultAgent) && (
                    <option value={draft.defaultAgent}>{draft.defaultAgent} (Unavailable)</option>
                  )}
                  {availableAgents.map((agent) => (
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
    </TaskSurface>
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
