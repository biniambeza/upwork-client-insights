function addButtons() {
  // Job cards: inspect the page (F12) and confirm this selector
  document.querySelectorAll('article, [data-test="JobTile"]').forEach(card => {
    if (card.dataset.statsAdded) return;
    card.dataset.statsAdded = "1";

    const link = card.querySelector('a[href*="/jobs/"]');
    if (!link) return;

    const btn = document.createElement("button");
    btn.textContent = "Show client stats";
    btn.style.cssText = "margin:8px 0;padding:4px 10px;cursor:pointer;";
    btn.onclick = async () => {
      btn.textContent = "Loading...";
      const html = await (await fetch(link.href, { credentials: "include" })).text();
      const doc = new DOMParser().parseFromString(html, "text/html");
      const text = doc.body.innerText;

      const hireRate = text.match(/(\d+%)\s*hire rate/i)?.[1] ?? "N/A";
      const jobsPosted = text.match(/([\d,]+)\s*jobs? posted/i)?.[1] ?? "N/A";

      btn.textContent = `Hire rate: ${hireRate} | Jobs posted: ${jobsPosted}`;
    };
    card.appendChild(btn);
  });
}

addButtons();
// Upwork loads cards dynamically, so watch for new ones
new MutationObserver(addButtons).observe(document.body, { childList: true, subtree: true });