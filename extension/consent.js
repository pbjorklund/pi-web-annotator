const permission = { data_collection: ["browsingActivity", "websiteContent"] };
const button = document.querySelector("#allow");
const status = document.querySelector("#status");

async function refresh() {
  const granted = await browser.permissions.contains(permission);
  if (!granted) return;
  button.hidden = true;
  status.textContent = "Access granted. Return to the annotated page and send again.";
}

button.addEventListener("click", async () => {
  button.disabled = true;
  status.textContent = "Waiting for Firefox…";
  try {
    const granted = await browser.permissions.request(permission);
    status.textContent = granted
      ? "Access granted. Return to the annotated page and send again."
      : "Access was not granted. No page data was sent.";
    if (granted) button.hidden = true;
  } catch (_) {
    status.textContent = "Firefox could not grant access. No page data was sent.";
  } finally {
    button.disabled = false;
  }
});

refresh().catch(() => {
  status.textContent = "Firefox could not check the current permission.";
});
