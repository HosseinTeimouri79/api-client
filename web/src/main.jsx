import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import { initI18n } from "./i18n/index.js";
import "./styles/app.css";

// the first paint already has the right language and direction
initI18n().finally(() => createRoot(document.getElementById("root")).render(<StrictMode><App /></StrictMode>));
