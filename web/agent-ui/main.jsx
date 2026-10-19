import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { initI18n } from "../src/i18n/index.js";
import { App, initialTheme } from "./App.jsx";
import "../src/styles/app.css";
import "./agent-ui.css";

// the Local Agent's own page: same look, components and languages as the web app
document.documentElement.dataset.theme = initialTheme();
initI18n().finally(() => createRoot(document.getElementById("root")).render(<StrictMode><App /></StrictMode>));
