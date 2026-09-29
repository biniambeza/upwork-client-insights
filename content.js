// A simple cache to avoid re-fetching jobs we've already parsed in this session
const statsCache = new Map();

// Helper function to extract stats from the raw HTML of a job page
function parseStatsFromHTML(html) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    
    // Default fallback values
    let hireRate = "N/A";
    let jobsPosted = "N/A";

    // Upwork typically keeps these in the "About the client" sidebar. 
    // We search the text content of the sidebar elements to find the stats.
    const allTextNodes = Array.from(doc.querySelectorAll('li, div, span'));
    
    for (const node of allTextNodes) {
        const text = node.innerText?.trim();
        if (text?.includes('% hire rate')) {
            hireRate = text.split(' ')[0]; // Extracts "80%"
        }
        if (text?.includes('jobs posted')) {
            jobsPosted = text.split(' ')[0]; // Extracts "15"
        }
    }
    
    return { hireRate, jobsPosted };
}

// Fetches the job detail page and parses the client stats
async function getClientStats(jobUrl) {
    if (statsCache.has(jobUrl)) return statsCache.get(jobUrl);

    try {
        const response = await fetch(jobUrl);
        if (!response.ok) throw new Error('Fetch failed');
        
        const html = await response.text();
        const stats = parseStatsFromHTML(html);
        
        statsCache.set(jobUrl, stats);
        return stats;
    } catch (error) {
        console.error("Error fetching job stats:", error);
        return { hireRate: "Error", jobsPosted: "Error" };
    }
}

// Processes an individual job card on the feed
async function processJobCard(card) {
    // Prevent processing the same card twice
    if (card.dataset.statsInjected) return;
    card.dataset.statsInjected = 'true';

    // 1. Find the job link URL
    const titleLink = card.querySelector('a.up-n-link');
    if (!titleLink || !titleLink.href) return;

    // 2. Find the container row where "Payment verified" and "$ spent" live
    // Upwork uses an unordered list (ul) for these items
    const clientInfoList = card.querySelector('[data-test="client-spend-box"]')?.closest('ul');
    if (!clientInfoList) return;

    // 3. Add a loading placeholder so the UI doesn't jump later
    const statsLi = document.createElement('li');
    statsLi.className = 'custom-stats-item text-light-on-muted';
    statsLi.innerHTML = `<span class="loading-text">Loading stats...</span>`;
    clientInfoList.appendChild(statsLi);

    // 4. Fetch the actual stats
    const stats = await getClientStats(titleLink.href);

    // 5. Update the UI with the fetched stats
    statsLi.innerHTML = `
        <strong class="stats-highlight">${stats.hireRate} hire rate</strong>, 
        ${stats.jobsPosted} jobs posted
    `;
}

// Set up a MutationObserver to watch for React rendering new job cards
const observer = new MutationObserver((mutations) => {
    // Throttle the processing slightly to avoid freezing the browser during rapid scrolls
    requestAnimationFrame(() => {
        const jobCards = document.querySelectorAll('section.up-card-section');
        jobCards.forEach(processJobCard);
    });
});

// Start observing the main application container
const mainContainer = document.querySelector('body');
if (mainContainer) {
    observer.observe(mainContainer, { childList: true, subtree: true });
}