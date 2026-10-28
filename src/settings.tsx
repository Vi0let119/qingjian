import React from "react";
import ReactDOM from "react-dom/client";
import SettingsApp from "./windows/settings/SettingsWindow";
import { ThemeProvider } from "./components/theme/ThemeProvider";
import "./styles/global.css";
import "./styles/refinement.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ThemeProvider>
      <SettingsApp />
    </ThemeProvider>
  </React.StrictMode>
);
