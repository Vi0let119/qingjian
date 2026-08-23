import React from "react";
import ReactDOM from "react-dom/client";
import FragmentApp from "./windows/fragment/FragmentWindow";
import { ThemeProvider } from "./components/theme/ThemeProvider";
import "./styles/global.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ThemeProvider>
      <FragmentApp />
    </ThemeProvider>
  </React.StrictMode>
);
