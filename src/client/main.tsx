import { createRoot } from "react-dom/client";
import "@xterm/xterm/css/xterm.css";
import { App } from "./App";
import "./styles.css";
import { applyFontSettings, readAppSettings } from "./settings";
import { applyAppTheme } from "./theme";

const settings = readAppSettings();
applyAppTheme(settings.theme);
applyFontSettings(settings);
createRoot(document.getElementById("root")!).render(<App />);
