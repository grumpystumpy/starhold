export function captureBrowserErrors(page, label) {
  page.on("pageerror", (error) => {
    console.error(`[${label}] pageerror: ${error.message}`);
  });
  page.on("console", (message) => {
    if (message.type() === "error") {
      console.error(`[${label}] console: ${message.text()}`);
    }
  });
  page.on("response", (response) => {
    const request = response.request();
    if (response.status() < 400) return;
    const url = new URL(response.url());
    const path = url.pathname + url.search;
    void response.text().then(
      (body) => {
        console.error(
          `[${label}] http ${response.status()} ${request.method()} ${path} body=${body.slice(0, 200)}`,
        );
      },
      (error) => {
        console.error(
          `[${label}] http ${response.status()} ${request.method()} ${path} body=<unreadable: ${error.message}>`,
        );
      },
    );
  });
}
