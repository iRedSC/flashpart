import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./style.css";

createRoot(document.querySelector<HTMLDivElement>("#app")!).render(
  React.createElement(React.StrictMode, null, React.createElement(App)),
);

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js");
  });
}
