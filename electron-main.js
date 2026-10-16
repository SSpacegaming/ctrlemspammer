import { app, BrowserWindow } from "electron";
import { startServer } from "./server.js";

let server;

async function createWindow() {
  const started = await startServer(0);
  server = started.server;
  const window = new BrowserWindow({
    width: 1120,
    height: 850,
    minWidth: 760,
    minHeight: 650,
    backgroundColor: "#111214",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  await window.loadURL(`http://127.0.0.1:${started.port}`);
}

app.whenReady().then(createWindow).catch((error) => {
  console.error(`Could not open CtrlEm image queue: ${error.message}`);
  app.quit();
});

app.on("window-all-closed", () => {
  if (server) server.close();
  if (process.platform !== "darwin") app.quit();
});
