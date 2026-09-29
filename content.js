console.log("🚀 Upwork Client Insights: Polling engine started (v5).");

const statsCache = new Map();

function parseStatsFromHTML(html) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    
    let hireRate = "N/A";
    let jobsPosted = "N/A";

    const bodyText = doc.body.innerText || "";
    // Match the exact phrasing Upwork uses on the job details page
    const hireMatch = bodyText.match(/(\d+)%\s*hire rate/i);
    const jobsMatch = bodyText.match(/(\d+)\s*jobs posted/i);

    if (hireMatch) hireRate = hireMatch[1] + "%";
    if (jobsMatch) jobsPosted = jobsMatch[1];
    
    return { hireRate, jobsPosted };
}

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
        return { hireRate: "Error", jobsPosted: "Error" };
    }
}

async function injectStatsIntoFeed() {
    // 1. Target the job cards based on the provided HTML structure
    const jobCards = document.querySelectorAll('section.air3-card-section.job-feed-tile, section[data-ev-sublocation="job_feed_tile"]');

    if (jobCards.length > 0 && !window.hasFoundCards) {
        console.log(`🔍 Found ${jobCards.length} job cards on screen.`);
        window.hasFoundCards = true; 
    }

    for (const card of jobCards) {
        if (card.dataset.statsInjected === 'true') continue;

        // 2. Find the job link within the card's title (the h3 tag)
        const titleLink = card.querySelector('h3.job-tile-title a');
        if (!titleLink || !titleLink.href) continue;

        // 3. Find the container holding the client badges (e.g., Payment verified, $ Spent)
        // Upwork uses a div with the class "badge-line" to wrap these elements
        const badgeLine = card.querySelector('.badge-line');
        if (!badgeLine) continue;

        // Lock card to prevent double injection
        card.dataset.statsInjected = 'true';

        // 4. Create the new element that matches Upwork's native styling (<small> tag)
        const statsContainer = document.createElement('small');
        statsContainer.className = 'pr-6 d-inline-block text-base-sm pb-3 text-light pb-md-0 ml-4x'; // Mimics the $ Spent spacing
        statsContainer.innerHTML = `<span class="loading-text" style="opacity: 0.7; font-style: italic;">Fetching stats...</span>`;
        
        // Append it inside the badge line
        badgeLine.appendChild(statsContainer);

        // 5. Fetch and inject the data
        const stats = await getClientStats(titleLink.href);
        statsContainer.innerHTML = `
            <strong><span style="color: #14a800;">${stats.hireRate}</span></strong> 
            <span class="text-light text-body-sm">hire rate, ${stats.jobsPosted} jobs</span>
        `;
        
        console.log(`✅ Injected stats for: ${titleLink.innerText.trim()}`);
    }
}

// Poll the DOM every 2 seconds
setInterval(injectStatsIntoFeed, 2000);