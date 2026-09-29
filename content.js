(() => {
    "use strict";

    const EXTENSION_CLASS = "uci-client-insights";

    /**
     * Find all Upwork job cards.
     *
     * Based on the HTML you provided:
     * [data-test="job-tile-list"] contains the job sections.
     */
    function getJobCards() {
        return document.querySelectorAll(
            '[data-test="job-tile-list"] > section'
        );
    }

    /**
     * Safely get text from an element.
     */
    function getText(parent, selector) {
        const element = parent.querySelector(selector);

        if (!element) {
            return null;
        }

        return element.innerText.trim();
    }

    /**
     * Extract information that is already present
     * in the Upwork job card.
     */
    function extractJobData(job) {

        // Job title
        const title = getText(
            job,
            '[data-test="job-tile-title"]'
        );

        // Client spending
        const spending = getText(
            job,
            '[data-test="client-spendings"]'
        );

        // Client country
        const country = getText(
            job,
            '[data-test="client-country"]'
        );

        // Payment verification
        const paymentElement = job.querySelector(
            '[data-test="payment-verification-status"]'
        );

        const paymentVerified = Boolean(paymentElement);

        // Client rating
        let rating = null;

        const ratingElement = job.querySelector(
            '.air3-rating'
        );

        if (ratingElement) {
            const ratingText = ratingElement.innerText.trim();

            const match = ratingText.match(
                /([0-9]+(?:\.[0-9]+)?)\s*out of 5/i
            );

            if (match) {
                rating = match[1];
            }
        }

        return {
            title,
            spending,
            country,
            paymentVerified,
            rating
        };
    }

    /**
     * Create our information box.
     */
    function createInsightsBox(data) {

        const box = document.createElement("div");

        box.className = EXTENSION_CLASS;

        box.innerHTML = `
            <div class="uci-title">
                Client Insights
            </div>

            <div class="uci-grid">

                <div class="uci-item">
                    <span class="uci-label">
                        Hire rate
                    </span>

                    <strong class="uci-value uci-hire-rate">
                        —
                    </strong>
                </div>

                <div class="uci-item">
                    <span class="uci-label">
                        Jobs posted
                    </span>

                    <strong class="uci-value uci-jobs-posted">
                        —
                    </strong>
                </div>

                <div class="uci-item">
                    <span class="uci-label">
                        Spent
                    </span>

                    <strong class="uci-value">
                        ${escapeHtml(data.spending || "—")}
                    </strong>
                </div>

                <div class="uci-item">
                    <span class="uci-label">
                        Country
                    </span>

                    <strong class="uci-value">
                        ${escapeHtml(data.country || "—")}
                    </strong>
                </div>

                <div class="uci-item">
                    <span class="uci-label">
                        Rating
                    </span>

                    <strong class="uci-value">
                        ${escapeHtml(data.rating || "—")}
                    </strong>
                </div>

                <div class="uci-item">
                    <span class="uci-label">
                        Payment
                    </span>

                    <strong class="uci-value">
                        ${data.paymentVerified ? "✓ Verified" : "—"}
                    </strong>
                </div>

            </div>
        `;

        return box;
    }

    /**
     * Prevent HTML injection when inserting text.
     */
    function escapeHtml(value) {

        return String(value)
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#039;");
    }

    /**
     * Process one job.
     */
    function processJob(job) {

        // Don't add the box twice.
        if (job.querySelector(`.${EXTENSION_CLASS}`)) {
            return;
        }

        const data = extractJobData(job);

        const box = createInsightsBox(data);

        /*
         * Put the box after the client information.
         * If that element doesn't exist, append it to the job.
         */
        const clientSpending = job.querySelector(
            '[data-test="client-spendings"]'
        );

        if (clientSpending) {

            const parent = clientSpending.parentElement;

            if (parent) {
                parent.after(box);
                return;
            }
        }

        job.appendChild(box);
    }

    /**
     * Process every currently visible job.
     */
    function processAllJobs() {

        const jobs = getJobCards();

        console.log(
            `[Upwork Client Insights] Found ${jobs.length} jobs`
        );

        jobs.forEach(processJob);
    }

    /**
     * Upwork loads more jobs while scrolling.
     *
     * MutationObserver lets us detect newly inserted
     * job cards without refreshing the page.
     */
    const observer = new MutationObserver(() => {

        processAllJobs();

    });

    observer.observe(document.body, {
        childList: true,
        subtree: true
    });

    /**
     * Initial processing.
     */
    processAllJobs();

    /**
     * Also run again shortly after page load because
     * Upwork is a dynamic application.
     */
    setTimeout(processAllJobs, 1000);
    setTimeout(processAllJobs, 3000);
    setTimeout(processAllJobs, 5000);

})();