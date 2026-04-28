// Extension Update Checker
//
// SECURITY (cleaned fork): the upstream `mia13165/SillyTavern-BotBrowser`
// repository was confirmed to ship a credential-stealing backdoor. This
// update checker originally pinged that exact repo's manifest.json and
// offered a one-click "Update" that would pull future releases from it.
// If the attacker pushed a new poisoned version, users of a cleaned fork
// would be prompted to re-install the malware.
//
// The checker is therefore made a no-op: it never performs a network
// request and never renders the update banner. If you want to re-enable
// update notifications, point MANIFEST_URLS at *your own* fork's
// manifest.json and remove the `UPDATE_CHECK_DISABLED` guard below.

const UPDATE_CHECK_DISABLED = true;

// Placeholder only - intentionally not reachable. Replace with your fork
// if you re-enable the checker.
const GITHUB_REPO = 'botbrowser-cleaned-fork-placeholder';
const MANIFEST_URLS = [];
const REPO_URL = 'https://botbrowser-update-disabled.invalid';

// Cache update check result for session
let updateCheckResult = null;
let hasShownNotification = false;

/**
 * Compare semver versions
 * @param {string} current - Current version (e.g., "1.1.2")
 * @param {string} latest - Latest version (e.g., "1.2.0")
 * @returns {number} -1 if current < latest, 0 if equal, 1 if current > latest
 */
function compareVersions(current, latest) {
    const currentParts = current.split('.').map(Number);
    const latestParts = latest.split('.').map(Number);

    for (let i = 0; i < Math.max(currentParts.length, latestParts.length); i++) {
        const curr = currentParts[i] || 0;
        const lat = latestParts[i] || 0;
        if (curr < lat) return -1;
        if (curr > lat) return 1;
    }
    return 0;
}

/**
 * Check for extension updates
 * @param {string} currentVersion - Current extension version from manifest
 * @returns {Promise<{hasUpdate: boolean, latestVersion: string|null, error: string|null}>}
 */
export async function checkForUpdates(currentVersion) {
    // Return cached result if available
    if (updateCheckResult !== null) {
        return updateCheckResult;
    }

    // SECURITY (cleaned fork): bypass all network checks. See header comment.
    if (UPDATE_CHECK_DISABLED) {
        updateCheckResult = {
            hasUpdate: false,
            latestVersion: null,
            currentVersion,
            error: null
        };
        return updateCheckResult;
    }

    // Try each manifest URL until one works
    for (const manifestUrl of MANIFEST_URLS) {
        try {
            const response = await fetch(manifestUrl, {
                cache: 'no-store',
                headers: { 'Accept': 'application/json' }
            });

            if (!response.ok) {
                continue; // Try next URL
            }

            const manifest = await response.json();
            const latestVersion = manifest.version;

            if (!latestVersion) {
                continue; // Try next URL
            }

            const hasUpdate = compareVersions(currentVersion, latestVersion) < 0;

            updateCheckResult = {
                hasUpdate,
                latestVersion,
                currentVersion,
                error: null
            };

            if (hasUpdate) {
                console.log(`[Bot Browser] Update available: v${currentVersion} → v${latestVersion}`);
            }

            return updateCheckResult;
        } catch (error) {
            // Try next URL
            continue;
        }
    }

    // All URLs failed - silently return no update
    updateCheckResult = {
        hasUpdate: false,
        latestVersion: null,
        currentVersion,
        error: 'Could not reach update server'
    };
    return updateCheckResult;
}

/**
 * Create and show the update banner in the Bot Browser menu
 * @param {HTMLElement} container - Container to prepend the banner to
 * @param {string} currentVersion - Current version
 * @param {string} latestVersion - Latest available version
 */
export function showUpdateBanner(container, currentVersion, latestVersion) {
    // Don't show if already shown or dismissed this session
    if (hasShownNotification || document.querySelector('.bot-browser-update-banner')) {
        return;
    }

    const banner = document.createElement('div');
    banner.className = 'bot-browser-update-banner';
    banner.innerHTML = `
        <span class="update-icon">↑</span>
        <span class="update-text">Update available: v${currentVersion} → v${latestVersion}</span>
        <a href="${REPO_URL}" target="_blank" class="update-link">Update</a>
        <button class="update-dismiss" title="Dismiss">×</button>
    `;

    // Dismiss handler
    banner.querySelector('.update-dismiss').addEventListener('click', (e) => {
        e.stopPropagation();
        banner.remove();
        hasShownNotification = true;
    });

    // Insert at the top of the container
    container.insertBefore(banner, container.firstChild);
}

/**
 * Initialize update checker - call this when Bot Browser menu opens
 * @param {HTMLElement} menuContainer - The Bot Browser menu container
 * @param {string} currentVersion - Current extension version
 */
export async function initUpdateChecker(menuContainer, currentVersion) {
    if (hasShownNotification) return;

    const result = await checkForUpdates(currentVersion);

    if (result.hasUpdate && result.latestVersion) {
        showUpdateBanner(menuContainer, currentVersion, result.latestVersion);
    }
}
