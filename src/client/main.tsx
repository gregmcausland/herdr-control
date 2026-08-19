import { createRoot } from "react-dom/client";
import "@xterm/xterm/css/xterm.css";
import { App } from "./App";
import "./styles.css";
import { applyAppTheme, readThemePreference } from "./theme";

applyAppTheme(readThemePreference());
createRoot(document.getElementById("root")!).render(<App />);
