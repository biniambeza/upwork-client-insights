/**
 * Upwork Accelerator - Smart In-Feed Client Insights & Hire Rate Intelligence
 * Fully compatible with Upwork's modern Air3 design system and Single-Page Architecture.
 */

(function () {
    'use strict';

    const HOVER_DELAY_MS = 250; // Snappy 250ms hover trigger
    const DETAIL_TIMEOUT_MS = 6000;
    const CACHE_TTL_MS = 1000 * 60 * 60 * 24; // 24-hour cache
    const LOG_PREFIX = '[Upwork Accelerator]';

    // Comprehensive selectors for modern Air3 Upwork and legacy views
    const JOB_CARD_SELECTOR = [
        'section.air3-card-section',
        'article[data-test="JobTile"]',
        'section[data-test="JobTile"]',
        'div[data-test="JobTile"]',
        '[data-test*="jobtile" i]',
        '[data-test*="job-tile" i]',
        'section.job-feed-tile',
        '[data-ev-sublocation="job_feed_tile"]',
        '[data-ev-label="search_result_impression"]',
        '.up-card-section',
        'article.job-tile'
    ].join(', ');

    const JOB_LINK_SELECTOR = [
        'a[data-test="UpLink"]',
        'a[data-test*="JobTile-title" i]',
        'h2.job-tile-title a',
        'h3.job-tile-title a',
        'h2 a',
        'h3 a',
        'a.air3-link',
        'a[href*="/jobs/"]',
        'a[href*="/nx/search/jobs/details/"]',
        'a[href*="/nx/find-work/details/"]',
        'a[href*="/freelance-jobs/"]'
    ].join(', ');

    // State maps
    const memoryCache = new Map();
    const cardStateMap = new WeakMap();
    let isExtensionActive = true;
    let autoFetchOnHover = true;
    let highlightBorders = true;
    let statsCounter = { scanned: 0, cached: 0 };

    // Load initial settings and cached data from chrome storage
    chrome.storage.local.get(['isEnabled', 'autoFetchOnHover', 'highlightBorders', 'hireRateCache'], (res) => {
        if (res.isEnabled !== undefined) isExtensionActive = res.isEnabled;
        if (res.autoFetchOnHover !== undefined) autoFetchOnHover = res.autoFetchOnHover;
        if (res.highlightBorders !== undefined) highlightBorders = res.highlightBorders;

        if (res.hireRateCache && typeof res.hireRateCache === 'object') {
            const now = Date.now();
            for (const [key, item] of Object.entries(res.hireRateCache)) {
                if (item && item.timestamp && now - item.timestamp < CACHE_TTL_MS) {
                    memoryCache.set(key, item);
                }
            }
        }

        renderScreenIndicator();
        scanAndEnhanceAllCards();
    });

    // Listen for configuration toggles from popup
    chrome.runtime.onMessage.addListener((message) => {
        if (message.action === 'toggleStatus') {
            isExtensionActive = message.status;
            renderScreenIndicator();
            if (!isExtensionActive) {
                removeAllInjections();
            } else {
                scanAndEnhanceAllCards();
            }
        } else if (message.action === 'updateSettings') {
            if (message.autoFetchOnHover !== undefined) autoFetchOnHover = message.autoFetchOnHover;
            if (message.highlightBorders !== undefined) {
                highlightBorders = message.highlightBorders;
                updateBorderStyles();
            }
        } else if (message.action === 'clearCache') {
            memoryCache.clear();
            chrome.storage.local.remove('hireRateCache');
            document.querySelectorAll('.accelerator-hire-badge').forEach(b => b.remove());
            scanAndEnhanceAllCards();
        }
    });

    function log(msg) {
        console.info(`${LOG_PREFIX} ${msg}`);
    }

    // Persist a resolved hire rate into memory and chrome.storage
    function saveRateToCache(cacheKey, rate, jobsPosted) {
        if (!cacheKey) return;
        const entry = {
            rate: rate,
            jobsPosted: jobsPosted || null,
            timestamp: Date.now()
        };
        memoryCache.set(cacheKey, entry);

        // Debounced sync to storage
        chrome.storage.local.get(['hireRateCache'], (result) => {
            const current = result.hireRateCache || {};
            current[cacheKey] = entry;
            chrome.storage.local.set({ hireRateCache: current });
        });
    }

    /* ==========================================================================
       CARD CONTEXT & JOB IDENTIFIERS
       ========================================================================== */

    function getJobContext(card) {
        const titleLink = card.querySelector(JOB_LINK_SELECTOR);
        if (!titleLink) {
            return { jobId: null, url: null, cacheKey: null };
        }

        try {
            const fullUrl = new URL(titleLink.href, location.href);
            const jobId = extractJobId(card, titleLink, fullUrl);
            const cacheKey = jobId || fullUrl.pathname;
            return { jobId, url: fullUrl, cacheKey };
        } catch {
            return { jobId: null, url: null, cacheKey: null };
        }
    }

    function extractJobId(card, link, url) {
        // Attribute inspection
        const idAttrs = ['data-job-id', 'data-job-uid', 'data-ev-job-uid', 'data-job-posting-id', 'data-test-key'];
        for (const attr of idAttrs) {
            const val = card.getAttribute(attr) || link?.getAttribute(attr) || card.querySelector(`[${attr}]`)?.getAttribute(attr);
            if (val) return val;
        }

        // URL tilde pattern (~01abc...)
        const tildeMatch = url.pathname.match(/~([a-zA-Z0-9]+)/) || url.href.match(/~([a-zA-Z0-9]+)/);
        if (tildeMatch) return tildeMatch[1];

        // Query parameter fallback
        const queryMatch = url.searchParams.get('jobId') || url.searchParams.get('job_id') || url.searchParams.get('uid');
        if (queryMatch) return queryMatch;

        return null;
    }

    /* ==========================================================================
       LAYER 1: INSTANT IN-FEED CLIENT SIGNALS
       ========================================================================== */

    function extractCardClientSignals(card) {
        const text = card.innerText || card.textContent || '';

        // Payment status
        const isVerified = /payment\s*verified/i.test(text);
        const isUnverified = /payment\s*unverified/i.test(text);

        // Spend extraction ($10k+ spent, $500 spent, $0 spent)
        let spendFormatted = null;
        let spendNumeric = null;
        const spendMatch = text.match(/\$([0-9]+(?:\.[0-9]+)?(?:[kmb]\+?|\+?))\s*spent/i) || text.match(/\$([0-9,]+)\s*spent/i);
        if (spendMatch) {
            spendFormatted = `$${spendMatch[1]} spent`;
            const raw = spendMatch[1].toLowerCase().replace(/,/g, '');
            if (raw.includes('k')) spendNumeric = parseFloat(raw) * 1000;
            else if (raw.includes('m')) spendNumeric = parseFloat(raw) * 1000000;
            else spendNumeric = parseFloat(raw) || 0;
        }

        // Rating extraction (e.g. 4.9 of 5 stars or 5.0)
        let rating = null;
        const ratingMatch = text.match(/([0-5]\.[0-9])\s*(?:of\s*5|\/5|\s*★|\s*stars)/i);
        if (ratingMatch) {
            rating = ratingMatch[1];
        }

        // Location extraction (common patterns in metadata line)
        let country = null;
        const countryMatch = text.match(/\b(United States|United Kingdom|Canada|Australia|Germany|France|Netherlands|Singapore|Israel|India|Pakistan|Ukraine|Brazil|Spain|Italy|Switzerland|United Arab Emirates)\b/i);
        if (countryMatch) {
            country = countryMatch[1];
        }

        // Proposals range
        let proposals = null;
        const propMatch = text.match(/proposals:\s*([0-9\s+to<]+)/i);
        if (propMatch) {
            proposals = propMatch[1].trim();
        }

        // Check if hire rate is already visible on the card
        let inlineHireRate = null;
        const hireMatch = text.match(/(\d{1,3})%\s*hire\s*rate/i);
        if (hireMatch) {
            inlineHireRate = parseInt(hireMatch[1], 10);
        }

        return {
            isVerified,
            isUnverified,
            spendFormatted,
            spendNumeric,
            rating,
            country,
            proposals,
            inlineHireRate
        };
    }

    /* ==========================================================================
       BADGE INJECTION & CARD STYLING
       ========================================================================== */

    function getInsightsContainer(card) {
        let container = card.querySelector('.accelerator-insights-row');
        if (container) return container;

        container = document.createElement('div');
        container.className = 'accelerator-insights-row';

        // Target ideal insertion point in modern Air3 layout:
        // Try placing directly after the title or at the top of the card metadata
        const titleElement = card.querySelector('h2, h3, [data-test*="JobTile-title" i]');
        const tokenContainer = card.querySelector('ul.air3-token-container, [data-test="job-tile-list"], .badge-line');

        if (tokenContainer && tokenContainer.parentNode) {
            tokenContainer.parentNode.insertBefore(container, tokenContainer.nextSibling);
        } else if (titleElement && titleElement.parentNode) {
            titleElement.parentNode.insertBefore(container, titleElement.nextSibling);
        } else {
            card.prepend(container);
        }

        return container;
    }

    function renderCardInsights(card, context) {
        if (!isExtensionActive) return;

        const signals = extractCardClientSignals(card);
        const container = getInsightsContainer(card);
        const cached = memoryCache.get(context.cacheKey);

        const hireRate = signals.inlineHireRate !== null ? signals.inlineHireRate : (cached ? cached.rate : null);

        // Build badges
        container.innerHTML = '';

        // 1. Hire Rate Badge
        const hireBadge = document.createElement('div');
        hireBadge.className = 'accelerator-badge accelerator-hire-badge';

        if (hireRate !== null) {
            hireBadge.innerText = `Hire Rate ${hireRate}%`;
            hireBadge.setAttribute('data-tooltip', `Client has an overall ${hireRate}% hiring rate across posted jobs.`);
            if (hireRate >= 70) {
                hireBadge.classList.add('badge-green');
            } else if (hireRate >= 40) {
                hireBadge.classList.add('badge-amber');
            } else {
                hireBadge.classList.add('badge-red');
            }
        } else {
            hireBadge.innerText = '⚡ Check Hire Rate';
            hireBadge.classList.add('badge-neutral', 'badge-interactive');
            hireBadge.setAttribute('data-tooltip', 'Hover or click to fetch exact client hiring rate history.');
        }
        container.appendChild(hireBadge);

        // 2. Spend Badge
        if (signals.spendFormatted) {
            const spendBadge = document.createElement('div');
            spendBadge.className = 'accelerator-badge';
            spendBadge.innerText = `💰 ${signals.spendFormatted}`;
            if (signals.spendNumeric >= 10000) {
                spendBadge.classList.add('badge-green');
                spendBadge.setAttribute('data-tooltip', 'High-value client with substantial platform spend.');
            } else if (signals.spendNumeric === 0) {
                spendBadge.classList.add('badge-amber');
                spendBadge.setAttribute('data-tooltip', 'New client with $0 platform spend history.');
            } else {
                spendBadge.classList.add('badge-neutral');
            }
            container.appendChild(spendBadge);
        }

        // 3. Payment Badge
        if (signals.isVerified) {
            const verifiedBadge = document.createElement('div');
            verifiedBadge.className = 'accelerator-badge badge-green';
            verifiedBadge.innerText = '✓ Verified Payment';
            container.appendChild(verifiedBadge);
        } else if (signals.isUnverified) {
            const unverifiedBadge = document.createElement('div');
            unverifiedBadge.className = 'accelerator-badge badge-red';
            unverifiedBadge.innerText = '⚠ Unverified Payment';
            unverifiedBadge.setAttribute('data-tooltip', 'Payment method is not verified yet. Exercise caution.');
            container.appendChild(unverifiedBadge);
        }

        // 4. Rating Badge
        if (signals.rating) {
            const ratingBadge = document.createElement('div');
            ratingBadge.className = 'accelerator-badge badge-neutral';
            ratingBadge.innerText = `★ ${signals.rating}`;
            container.appendChild(ratingBadge);
        }

        // Update card border accents based on overall trust score
        applyCardHighlight(card, signals, hireRate);
    }

    function applyCardHighlight(card, signals, hireRate) {
        if (!highlightBorders || !isExtensionActive) {
            card.classList.remove('accelerator-border-green', 'accelerator-border-red', 'accelerator-border-neutral');
            return;
        }

        card.classList.remove('accelerator-border-green', 'accelerator-border-red', 'accelerator-border-neutral');

        if (signals.isUnverified || (signals.spendNumeric !== null && signals.spendNumeric === 0 && hireRate !== null && hireRate < 30)) {
            card.classList.add('accelerator-border-red');
        } else if ((hireRate !== null && hireRate >= 70) || (signals.spendNumeric !== null && signals.spendNumeric >= 10000 && signals.isVerified)) {
            card.classList.add('accelerator-border-green');
        } else {
            card.classList.add('accelerator-border-neutral');
        }
    }

    function updateBorderStyles() {
        document.querySelectorAll(JOB_CARD_SELECTOR).forEach(card => {
            const context = getJobContext(card);
            const signals = extractCardClientSignals(card);
            const cached = memoryCache.get(context.cacheKey);
            const hireRate = cached ? cached.rate : null;
            applyCardHighlight(card, signals, hireRate);
        });
    }

    /* ==========================================================================
       LAYER 2: HIRE RATE EXTRACTION (HTML / NUXT DATA / SLIDER DRAWER)
       ========================================================================== */

    async function fetchHireRate(context, card) {
        if (!context.url || !context.cacheKey) return null;

        // Check memory cache first
        if (memoryCache.has(context.cacheKey)) {
            return memoryCache.get(context.cacheKey);
        }

        try {
            const hireBadge = card.querySelector('.accelerator-hire-badge');
            if (hireBadge) {
                hireBadge.innerText = 'Checking...';
                hireBadge.className = 'accelerator-badge accelerator-hire-loading';
            }

            const response = await fetch(context.url.href, {
                credentials: 'same-origin',
                headers: { 'Accept': 'text/html,application/xhtml+xml,application/xml' }
            });

            if (!response.ok) throw new Error(`HTTP ${response.status}`);

            const html = await response.text();
            const extracted = parseHireRateFromHTML(html);

            if (extracted && extracted.rate !== null) {
                saveRateToCache(context.cacheKey, extracted.rate, extracted.jobsPosted);
                statsCounter.cached++;
                return extracted;
            } else {
                // If not found in static response, mark as unlisted
                const fallback = { rate: null, unlisted: true };
                saveRateToCache(context.cacheKey, null, null);
                return fallback;
            }
        } catch (err) {
            log(`Error fetching details for ${context.jobId}: ${err.message}`);
            return null;
        }
    }

    function parseHireRateFromHTML(html) {
        // Pattern 1: Direct text match (common in rendered client markup)
        const textMatch = html.match(/(\d{1,3})%\s*hire\s*rate/i) || html.match(/(?:hire\s*rate\s*:?\s*)(\d{1,3})%/i);
        const jobsMatch = html.match(/(\d+)\s*jobs?\s*posted/i);
        const jobsPosted = jobsMatch ? parseInt(jobsMatch[1], 10) : null;

        if (textMatch) {
            const rate = parseInt(textMatch[1], 10);
            if (!isNaN(rate) && rate >= 0 && rate <= 100) {
                return { rate, jobsPosted };
            }
        }

        // Pattern 2: JSON / GraphQL / Nuxt embedded state
        const jsonKeys = [
            /"hireRate"\s*:\s*(\d{1,3}(?:\.\d+)?)/i,
            /"clientHireRate"\s*:\s*(\d{1,3}(?:\.\d+)?)/i,
            /"buyerHireRate"\s*:\s*(\d{1,3}(?:\.\d+)?)/i,
            /"hireRateScore"\s*:\s*(\d{1,3}(?:\.\d+)?)/i
        ];

        for (const pattern of jsonKeys) {
            const match = html.match(pattern);
            if (match) {
                let val = parseFloat(match[1]);
                if (val <= 1.0 && val > 0) val = Math.round(val * 100);
                val = Math.round(val);
                if (val >= 0 && val <= 100) return { rate: val, jobsPosted };
            }
        }

        // Pattern 3: Total hired vs Total posted
        const hiredMatch = html.match(/"totalHiredJobs"\s*:\s*(\d+)/i) || html.match(/"totalJobsWithHires"\s*:\s*(\d+)/i);
        const postedMatch = html.match(/"totalPostedJobs"\s*:\s*(\d+)/i);
        if (hiredMatch && postedMatch) {
            const hired = parseInt(hiredMatch[1], 10);
            const posted = parseInt(postedMatch[1], 10);
            if (posted > 0) {
                const rate = Math.round((hired / posted) * 100);
                return { rate, jobsPosted: posted };
            }
        }

        return null;
    }

    /* ==========================================================================
       DRAWER / SLIDER REAL-TIME INTERCEPTOR
       ========================================================================== */

    // When the user clicks a job card, Upwork opens an air3-slider drawer with live client data.
    // We capture this live data in real time and automatically cache it for the feed!
    function observeJobSliderDrawer() {
        const drawerObserver = new MutationObserver(() => {
            const drawer = document.querySelector('.air3-slider, [data-test="job-details-slider"], aside[role="complementary"]');
            if (!drawer) return;

            const drawerText = drawer.innerText || drawer.textContent || '';
            const hireMatch = drawerText.match(/(\d{1,3})%\s*hire\s*rate/i);
            const jobsMatch = drawerText.match(/(\d+)\s*jobs?\s*posted/i);

            if (hireMatch) {
                const rate = parseInt(hireMatch[1], 10);
                const jobsPosted = jobsMatch ? parseInt(jobsMatch[1], 10) : null;

                // Detect current Job ID from window URL or drawer attributes
                const urlMatch = location.pathname.match(/~([a-zA-Z0-9]+)/);
                const currentJobId = urlMatch ? urlMatch[1] : null;

                if (currentJobId) {
                    saveRateToCache(currentJobId, rate, jobsPosted);

                    // Immediately update any visible feed cards matching this Job ID
                    document.querySelectorAll(JOB_CARD_SELECTOR).forEach(card => {
                        const ctx = getJobContext(card);
                        if (ctx.jobId === currentJobId) {
                            renderCardInsights(card, ctx);
                        }
                    });
                }
            }
        });

        drawerObserver.observe(document.body, { childList: true, subtree: true });
    }

    /* ==========================================================================
       HOVER & INTERACTION HANDLERS
       ========================================================================== */

    function setupCardListeners(card) {
        let cardState = cardStateMap.get(card);
        if (!cardState) {
            cardState = { timer: null, isProcessing: false };
            cardStateMap.set(card, cardState);
        }

        const triggerFetch = async () => {
            if (!isExtensionActive || cardState.isProcessing) return;
            const context = getJobContext(card);
            if (!context.cacheKey || memoryCache.has(context.cacheKey)) return;

            cardState.isProcessing = true;
            const result = await fetchHireRate(context, card);
            cardState.isProcessing = false;

            if (result) {
                renderCardInsights(card, context);
            }
        };

        // Hover trigger (250ms threshold)
        card.addEventListener('mouseenter', () => {
            if (!autoFetchOnHover || !isExtensionActive) return;
            const context = getJobContext(card);
            if (memoryCache.has(context.cacheKey)) return;

            if (cardState.timer) clearTimeout(cardState.timer);
            cardState.timer = setTimeout(triggerFetch, HOVER_DELAY_MS);
        });

        card.addEventListener('mouseleave', () => {
            if (cardState.timer) {
                clearTimeout(cardState.timer);
                cardState.timer = null;
            }
        });

        // Click trigger on hire badge
        card.addEventListener('click', (e) => {
            const badge = e.target.closest('.accelerator-hire-badge');
            if (badge && badge.classList.contains('badge-interactive')) {
                triggerFetch();
            }
        });
    }

    /* ==========================================================================
       INITIALIZATION & SPA MUTATION OBSERVER
       ========================================================================== */

    function processCard(card) {
        if (!isExtensionActive) return;
        const context = getJobContext(card);
        renderCardInsights(card, context);
        setupCardListeners(card);
        statsCounter.scanned++;
    }

    function scanAndEnhanceAllCards() {
        if (!isExtensionActive) return;
        const cards = document.querySelectorAll(JOB_CARD_SELECTOR);
        cards.forEach(processCard);
    }

    function removeAllInjections() {
        document.querySelectorAll('.accelerator-insights-row').forEach(el => el.remove());
        document.querySelectorAll('.accelerator-border-green, .accelerator-border-red, .accelerator-border-neutral')
            .forEach(el => el.classList.remove('accelerator-border-green', 'accelerator-border-red', 'accelerator-border-neutral'));
    }

    let mutationDebounceTimer = null;
    function observePageMutations() {
        const observer = new MutationObserver((mutations) => {
            if (!isExtensionActive) return;

            let hasNewNodes = false;
            for (const mutation of mutations) {
                if (mutation.addedNodes.length > 0) {
                    hasNewNodes = true;
                    break;
                }
            }

            if (hasNewNodes) {
                if (mutationDebounceTimer) clearTimeout(mutationDebounceTimer);
                mutationDebounceTimer = setTimeout(() => {
                    scanAndEnhanceAllCards();
                }, 300);
            }
        });

        observer.observe(document.body, { childList: true, subtree: true });
    }

    /* ==========================================================================
       STATUS INDICATOR BAR (FLOATING UI)
       ========================================================================== */

    function renderScreenIndicator() {
        let indicator = document.getElementById('accelerator-screen-indicator');
        if (!indicator) {
            indicator = document.createElement('div');
            indicator.id = 'accelerator-screen-indicator';
            document.body.appendChild(indicator);

            indicator.addEventListener('click', () => {
                indicator.classList.toggle('minimized');
            });
        }

        if (isExtensionActive) {
            indicator.innerHTML = `
                <span class="indicator-dot dot-active"></span>
                <span class="indicator-label">Accelerator Active</span>
            `;
            indicator.className = 'accelerator-floating-pill status-active';
        } else {
            indicator.innerHTML = `
                <span class="indicator-dot dot-paused"></span>
                <span class="indicator-label">Accelerator Paused</span>
            `;
            indicator.className = 'accelerator-floating-pill status-paused';
        }
    }

    // Main entry point
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            renderScreenIndicator();
            scanAndEnhanceAllCards();
            observePageMutations();
            observeJobSliderDrawer();
        });
    } else {
        renderScreenIndicator();
        scanAndEnhanceAllCards();
        observePageMutations();
        observeJobSliderDrawer();
    }

    log('Engine loaded successfully with modern Air3 support.');
})();