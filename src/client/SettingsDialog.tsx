import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import type { AgentDefinition } from "../shared/agents";
import { DEFAULT_SETTINGS, type AppSettings } from "./settings";
import { TaskSurface } from "./Surface";
import { applyAppTheme, isThemeId, themeOptions } from "./theme";

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
  const preview = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (preview.current) applyAppTheme(draft.theme, preview.current);
  }, [draft.theme]);

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
      description="Appearance, terminal and thread defaults."
      className="settings-dialog preferences-screen"
      fitViewport
      onClose={onCancel}
      onSubmit={submit}
      actions={
        <>
          <button
            className="surface-button secondary"
            type="button"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button className="surface-button primary" type="submit">
            Save changes
          </button>
        </>
      }
    >
      <div className="settings-sections">
        <fieldset className="preference-section">
          <legend>Appearance</legend>
          <div className="settings-fields">
            <label className="settings-wide">
              <span>Theme</span>
              <select
                value={draft.theme}
                onChange={(event) => {
                  if (isThemeId(event.target.value))
                    setDraft({ ...draft, theme: event.target.value });
                }}
              >
                {themeOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <div
              ref={preview}
              className="settings-preview settings-wide"
              aria-label="Appearance preview"
              style={{
                fontFamily: draft.interfaceFontFamily,
                fontSize: draft.interfaceFontSize,
              }}
            >
              <span className="preview-caption">Preview</span>
              <span>Review the latest changes.</span>
              <div className="preview-palette" aria-hidden="true">
                <i />
                <i />
                <i />
                <i />
              </div>
            </div>
            <FontField
              label="App font"
              value={draft.interfaceFontFamily}
              defaultValue={DEFAULT_SETTINGS.interfaceFontFamily}
              onChange={(interfaceFontFamily) =>
                setDraft({ ...draft, interfaceFontFamily })
              }
            />
            <SizeField
              label="App text size"
              value={draft.interfaceFontSize}
              min={13}
              max={20}
              onChange={(interfaceFontSize) =>
                setDraft({ ...draft, interfaceFontSize })
              }
            />
          </div>
        </fieldset>
        <fieldset className="preference-section">
          <legend>Terminal</legend>
          <div className="settings-fields">
            <FontField
              label="Terminal font"
              value={draft.terminalFontFamily}
              defaultValue={DEFAULT_SETTINGS.terminalFontFamily}
              mono
              onChange={(terminalFontFamily) =>
                setDraft({ ...draft, terminalFontFamily })
              }
            />
            <SizeField
              label="Terminal text size"
              value={draft.terminalFontSize}
              min={10}
              max={32}
              onChange={(terminalFontSize) =>
                setDraft({ ...draft, terminalFontSize })
              }
            />
            <div
              className="terminal-font-preview settings-wide"
              style={{
                fontFamily: draft.terminalFontFamily,
                fontSize: draft.terminalFontSize,
              }}
              aria-label="Terminal font preview"
            >
              <span aria-hidden="true">›</span> Ready for your next task
              <span
                className={
                  draft.terminalCursorBlink
                    ? "preview-cursor blinking"
                    : "preview-cursor"
                }
                aria-hidden="true"
              />
            </div>
            <SettingToggle
              label="Blink terminal cursor"
              checked={draft.terminalCursorBlink}
              onChange={(terminalCursorBlink) =>
                setDraft({ ...draft, terminalCursorBlink })
              }
            />
          </div>
        </fieldset>
        <fieldset className="preference-section">
          <legend>New threads</legend>
          <div className="settings-fields">
            <label className="settings-wide">
              <span>Default agent</span>
              <select
                value={draft.defaultAgent}
                onChange={(event) =>
                  setDraft({ ...draft, defaultAgent: event.target.value })
                }
              >
                {!availableAgents.some(
                  ({ kind }) => kind === draft.defaultAgent,
                ) && (
                  <option value={draft.defaultAgent}>
                    {draft.defaultAgent} (Unavailable)
                  </option>
                )}
                {availableAgents.map((agent) => (
                  <option value={agent.kind} key={agent.kind}>
                    {agent.label}
                  </option>
                ))}
              </select>
            </label>
            <SettingToggle
              label="Skip permission prompts by default"
              checked={draft.defaultSkipPermissions}
              onChange={(defaultSkipPermissions) =>
                setDraft({ ...draft, defaultSkipPermissions })
              }
            >
              You can change this for each new thread.
            </SettingToggle>
          </div>
        </fieldset>
        <div className="settings-reset-row">
          <span>Settings are saved on this device.</span>
          <button
            className="surface-button secondary"
            type="button"
            onClick={() => setDraft(DEFAULT_SETTINGS)}
          >
            Reset defaults
          </button>
        </div>
      </div>
    </TaskSurface>
  );
}

function FontField({
  label,
  value,
  defaultValue,
  mono,
  onChange,
}: {
  label: string;
  value: string;
  defaultValue: string;
  mono?: boolean;
  onChange(value: string): void;
}) {
  const options = [
    { label: "Default", value: defaultValue },
    ...(mono
      ? [
          { label: "System mono", value: "monospace" },
          { label: "Courier", value: "'Courier New', monospace" },
        ]
      : [
          { label: "System sans", value: "system-ui, sans-serif" },
          { label: "Serif", value: "Georgia, serif" },
        ]),
  ];
  const [custom, setCustom] = useState(
    !options.some((option) => option.value === value),
  );
  // Reset defaults and externally restored settings should also reset the font picker.
  useEffect(() => {
    if (options.some((option) => option.value === value)) setCustom(false);
  }, [value]);
  return (
    <div className="settings-font">
      <label>
        <span>{label}</span>
        <select
          value={custom ? "custom" : value}
          onChange={(event) => {
            if (event.target.value === "custom") setCustom(true);
            else {
              setCustom(false);
              onChange(event.target.value);
            }
          }}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
          <option value="custom">Custom…</option>
        </select>
      </label>
      {custom && (
        <label>
          <span>Custom {label.toLowerCase()}</span>
          <input
            required
            maxLength={200}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            spellCheck={false}
          />
        </label>
      )}
    </div>
  );
}

function SizeField({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange(value: number): void;
}) {
  return (
    <label>
      <span>Text size</span>
      <span className="settings-number">
        <input
          aria-label={label}
          type="number"
          required
          min={min}
          max={max}
          value={value}
          onChange={(event) => {
            if (Number.isFinite(event.target.valueAsNumber))
              onChange(event.target.valueAsNumber);
          }}
        />
        <span aria-hidden="true">px</span>
      </span>
    </label>
  );
}

function SettingToggle({
  label,
  checked,
  onChange,
  children,
}: {
  label: string;
  checked: boolean;
  onChange(value: boolean): void;
  children?: ReactNode;
}) {
  return (
    <label className="settings-toggle settings-wide">
      <span>
        <strong>{label}</strong>
        {children && <small>{children}</small>}
      </span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
    </label>
  );
}

export function SettingsIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 7h9m4 0h3M4 17h3m4 0h9" />
      <circle cx="15" cy="7" r="2" />
      <circle cx="9" cy="17" r="2" />
    </svg>
  );
}
