export function captureBrowserErrors(page, label) {
  page.on("pageerror", (error) => {
    console.error(`[${label}] pageerror: ${error.message}`);
  });
  page.on("console", (message) => {
    if (message.type() === "error") {
      console.error(`[${label}] console: ${message.text()}`);
    }
  });
}
