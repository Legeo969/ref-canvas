import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import { DialogProvider } from "./components/DialogProvider";
import { TooltipLayer } from "./components/TooltipLayer";
import "./styles/index.css";

const root = document.getElementById("root");
if (!root) throw new Error("ROOT_ELEMENT_MISSING");

createRoot(root).render(
  <React.StrictMode>
    <DialogProvider>
      <App />
      <TooltipLayer />
    </DialogProvider>
  </React.StrictMode>,
);
