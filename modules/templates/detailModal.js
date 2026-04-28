import { sanitizeImageUrl } from '../utils/utils.js';

// SECURITY (cleaned fork): the original extension inserted a card's
// `metadata` HTML into this modal via `${metadata}` template interpolation
// without any sanitization (see the former line 210). Combined with a
// poisoned card delivered by the attacker archive (now disabled), this
// was the XSS sink that launched the credential-stealing payload via
// <img ... onload="...">.
//
// As defense in depth, we now sanitize ALL metadata HTML before it is
// inserted. This uses SillyTavern's global DOMPurify when available, and
// otherwise falls back to a DOMParser-based strip that drops script/iframe/
// style/link/meta/object/embed/form elements and every `on*` event-handler
// attribute, and that whitelists URL schemes.
function sanitizeMetadataHTML(raw) {
    if (raw == null) return '';
    const str = String(raw);
    if (!str) return '';

    // Prefer SillyTavern's bundled DOMPurify if it is present on window.
    try {
        const dp =
            (typeof window !== 'undefined' && window.DOMPurify) ||
            (typeof globalThis !== 'undefined' && globalThis.DOMPurify);
        if (dp && typeof dp.sanitize === 'function') {
            return dp.sanitize(str, {
                USE_PROFILES: { html: true },
                FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'textarea', 'button', 'meta', 'link', 'base'],
                FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover', 'onmouseenter', 'onmouseleave', 'onfocus', 'onblur', 'onchange', 'onsubmit', 'onkeydown', 'onkeyup', 'onkeypress', 'onpointerdown', 'onpointerup', 'onanimationstart', 'onanimationend', 'ontransitionend', 'formaction', 'srcdoc']
            });
        }
    } catch { /* fall through to manual strip */ }

    // Manual fallback sanitizer.
    try {
        if (typeof DOMParser === 'undefined') {
            // Conservative HTML-escape if no parser is available.
            return str
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#039;');
        }
        const doc = new DOMParser().parseFromString(str, 'text/html');
        const bannedTags = new Set([
            'script', 'style', 'iframe', 'object', 'embed', 'form',
            'input', 'textarea', 'button', 'meta', 'link', 'base',
            'frame', 'frameset', 'applet'
        ]);
        const safeSchemes = /^(https?:|mailto:|tel:|data:image\/(png|jpeg|gif|webp|svg\+xml);)/i;

        const walk = Array.from(doc.body.querySelectorAll('*'));
        for (const el of walk) {
            const tag = el.tagName.toLowerCase();
            if (bannedTags.has(tag)) {
                el.remove();
                continue;
            }
            for (const attr of Array.from(el.attributes)) {
                const name = attr.name.toLowerCase();
                if (name.startsWith('on') || name === 'srcdoc' || name === 'formaction') {
                    el.removeAttribute(attr.name);
                    continue;
                }
                if (name === 'href' || name === 'src' || name === 'xlink:href' || name === 'action') {
                    const val = (attr.value || '').trim();
                    if (val && !safeSchemes.test(val) && !val.startsWith('/') && !val.startsWith('#') && !val.startsWith('./') && !val.startsWith('../')) {
                        el.removeAttribute(attr.name);
                    }
                }
                if (name === 'style') {
                    // Strip CSS expressions and url() with javascript: schemes.
                    const v = attr.value || '';
                    if (/expression\s*\(|javascript:|url\s*\(\s*["']?\s*javascript:/i.test(v)) {
                        el.removeAttribute('style');
                    }
                }
            }
        }
        return doc.body.innerHTML;
    } catch {
        return '';
    }
}

export function buildDetailModalHTML(cardName, imageUrl, isLorebook, cardCreator, tags, creator, websiteDesc, description, descPreview, personality, scenario, firstMessage, alternateGreetings, exampleMsg, entries, entriesCount, metadata, isBookmarked = false, isRandom = false, isImported = false, characterExistsInST = false, sourceUrlData = null, chubFeatures = null) {
    const safeImageUrl = sanitizeImageUrl(imageUrl);

    // Random buttons HTML (only shown when viewing a random card)
    const randomButtonsHTML = isRandom ? `
                <div class="bot-browser-detail-actions-row bot-browser-random-row">
                    <button class="bot-browser-random-same-btn" title="Get another random card from the same source">
                        <i class="fa-solid fa-shuffle"></i> <span>Same Source</span>
                    </button>
                    <button class="bot-browser-random-any-btn" title="Get a random card from any source">
                        <i class="fa-solid fa-dice"></i> <span>Any Source</span>
                    </button>
                </div>` : '';

    // Open in SillyTavern button (only for imported cards that exist in ST)
    const openInSTButtonHTML = (isImported && characterExistsInST) ? `
                <div class="bot-browser-detail-actions-row bot-browser-open-st-row">
                    <button class="bot-browser-open-in-st-btn" title="Open a chat with this character in SillyTavern">
                        <i class="fa-solid fa-comments"></i> <span>Open Chat in SillyTavern</span>
                    </button>
                </div>` : '';

    // View on Website button (only for live API sources)
    const viewOnWebsiteHTML = sourceUrlData ? `
                <button class="bot-browser-view-source-btn" data-url="${sourceUrlData.url}" title="View on ${sourceUrlData.serviceName}">
                    <i class="fa-solid fa-external-link"></i>
                </button>` : '';

    return `
        <div class="bot-browser-detail-header">
            <h2>${cardName}</h2>
            <div class="bot-browser-detail-header-actions">
                ${viewOnWebsiteHTML}
                <button class="bot-browser-detail-close">
                    <i class="fa-solid fa-times"></i>
                </button>
            </div>
        </div>

        <div class="bot-browser-detail-content">
            <div class="bot-browser-detail-scroll-container">
                <div class="bot-browser-detail-actions-container">
                    <div class="bot-browser-detail-actions-row">
                        <button class="bot-browser-import-button">
                            <i class="fa-solid fa-download"></i> <span>Import</span>
                        </button>
                        <button class="bot-browser-bookmark-btn ${isBookmarked ? 'bookmarked' : ''}">
                            <i class="fa-${isBookmarked ? 'solid' : 'regular'} fa-bookmark"></i>
                            <span>${isBookmarked ? 'Saved' : 'Save'}</span>
                        </button>
                        ${chubFeatures?.isChubCard && chubFeatures?.isLoggedIn ? `
                        <button class="bot-browser-chub-favorite-btn ${chubFeatures.isFavorited ? 'favorited' : ''}" data-char-id="${chubFeatures.charId || ''}">
                            <i class="fa-${chubFeatures.isFavorited ? 'solid' : 'regular'} fa-heart"></i>
                            <span>${chubFeatures.isFavorited ? 'Favorited' : 'Favorite'}</span>
                        </button>
                        ` : ''}
                        <button class="bot-browser-detail-back">
                            <i class="fa-solid fa-arrow-left"></i> <span>Back</span>
                        </button>
                    </div>
                    ${randomButtonsHTML}
                    ${openInSTButtonHTML}
                </div>

                <div class="bot-browser-detail-image ${safeImageUrl ? 'clickable-image' : ''}" style="background-image: url('${safeImageUrl}');" ${safeImageUrl ? `data-image-url="${safeImageUrl}" title="Click to enlarge"` : ''}>
                    ${!safeImageUrl ? '<i class="fa-solid fa-user"></i>' : ''}
                    ${safeImageUrl ? '<div style="position: absolute; bottom: 6px; right: 6px; background: rgba(0,0,0,0.5); padding: 3px 6px; border-radius: 3px; font-size: 10px; color: rgba(255,255,255,0.7); pointer-events: none;"><i class="fa-solid fa-search-plus" style="font-size: 9px; margin-right: 3px;"></i>Click to enlarge</div>' : ''}
                </div>

                <div class="bot-browser-detail-info">
                    ${buildDetailSections(isLorebook, cardCreator, tags, creator, websiteDesc, description, descPreview, personality, scenario, firstMessage, alternateGreetings, exampleMsg, entries, entriesCount, metadata, chubFeatures)}
                </div>
            </div>
        </div>
    `;
}

function buildDetailSections(isLorebook, cardCreator, tags, creator, websiteDesc, description, descPreview, personality, scenario, firstMessage, alternateGreetings, exampleMsg, entries, entriesCount, metadata, chubFeatures = null) {
    let html = '';

    if (isLorebook) {
        html += `
                <div class="bot-browser-detail-section">
                    <div class="bot-browser-detail-text">
                        <strong>Type:</strong> Lorebook<br>
                        <strong>Entries:</strong> ${entriesCount}
                    </div>
                </div>`;
    }

    if (cardCreator) {
        html += `
                <div class="bot-browser-detail-section">
                    <div class="bot-browser-detail-creator">
                        <i class="fa-solid fa-user-pen"></i>
                        <button class="bot-browser-creator-link" data-creator="${creator}">
                            ${cardCreator}
                        </button>
                    </div>
                </div>`;
    }

    if (tags.length > 0) {
        html += `
                <div class="bot-browser-detail-section">
                    <div class="bot-browser-detail-tags">
                        ${tags.map(tag => `<button class="bot-browser-tag-pill bot-browser-tag-clickable" data-tag="${tag}">${tag}</button>`).join('')}
                    </div>
                </div>`;
    }

    if (websiteDesc) {
        html += buildCollapsibleSection('website-desc', 'Website Description', websiteDesc);
    }

    if (description) {
        html += buildCollapsibleSection('description', 'Description', description);
    } else if (!websiteDesc && descPreview) {
        html += buildCollapsibleSection('desc-preview', 'Description Preview', descPreview);
    }

    if (!isLorebook) {
        if (personality) {
            html += buildSection('Personality', personality);
        }

        if (scenario) {
            html += buildSection('Scenario', scenario);
        }

        if (firstMessage) {
            html += buildSection('First Message', firstMessage);
        }

        if (alternateGreetings.length > 0) {
            html += buildAlternateGreetingsSection(alternateGreetings);
        }

        if (exampleMsg) {
            html += buildSection('Example Messages', exampleMsg);
        }
    }

    if (isLorebook && entries && Array.isArray(entries) && entries.length > 0) {
        html += buildLorebookEntriesSection(entries, entriesCount);
    }

    // Gallery section (Chub)
    if (chubFeatures?.galleryImages?.length > 0) {
        html += `
                <div class="bot-browser-detail-section">
                    <button class="bot-browser-collapse-toggle" data-target="bb-gallery-section">
                        <i class="fa-solid fa-chevron-right"></i>
                        <h4>Gallery (${chubFeatures.galleryImages.length})</h4>
                    </button>
                    <div class="bot-browser-collapse-content" id="bb-gallery-section" style="display: none;">
                        <div class="bot-browser-gallery-grid">
                            ${chubFeatures.galleryImages.map(img => `
                                <div class="bot-browser-gallery-thumb clickable-image"
                                     data-image-url="${img.imageUrl}"
                                     style="background-image: url('${img.imageUrl}');">
                                </div>
                            `).join('')}
                        </div>
                    </div>
                </div>`;
    }

    // Follow button (Chub)
    if (chubFeatures?.isChubCard && chubFeatures?.isLoggedIn && creator) {
        html += `
                <div class="bot-browser-detail-section bot-browser-follow-section">
                    <button class="bot-browser-follow-btn ${chubFeatures.isFollowing ? 'following' : ''}" data-username="${creator}">
                        <i class="fa-solid fa-${chubFeatures.isFollowing ? 'check' : 'user-plus'}"></i>
                        <span>${chubFeatures.isFollowing ? 'Following' : 'Follow'} @${creator}</span>
                    </button>
                </div>`;
    }

    // Enhanced Chub stats
    if (chubFeatures?.stats) {
        const s = chubFeatures.stats;
        let statsHTML = '<div class="bot-browser-detail-stats-grid">';
        if (s.downloads) statsHTML += `<div class="bb-stat"><i class="fa-solid fa-download"></i><span>${s.downloads.toLocaleString()}</span><small>Downloads</small></div>`;
        if (s.favorites) statsHTML += `<div class="bb-stat"><i class="fa-solid fa-heart"></i><span>${s.favorites.toLocaleString()}</span><small>Favorites</small></div>`;
        if (s.rating) statsHTML += `<div class="bb-stat"><i class="fa-solid fa-star"></i><span>${s.rating.toFixed(1)}</span><small>Rating (${s.ratingCount || 0})</small></div>`;
        if (s.tokens) statsHTML += `<div class="bb-stat"><i class="fa-solid fa-coins"></i><span>${s.tokens.toLocaleString()}</span><small>Tokens</small></div>`;
        if (s.chats) statsHTML += `<div class="bb-stat"><i class="fa-solid fa-comments"></i><span>${s.chats.toLocaleString()}</span><small>Chats</small></div>`;
        if (s.messages) statsHTML += `<div class="bb-stat"><i class="fa-solid fa-message"></i><span>${s.messages.toLocaleString()}</span><small>Messages</small></div>`;
        statsHTML += '</div>';
        html += `
                <div class="bot-browser-detail-section">
                    <button class="bot-browser-collapse-toggle" data-target="bb-stats-section">
                        <i class="fa-solid fa-chevron-down"></i>
                        <h4>Stats</h4>
                    </button>
                    <div class="bot-browser-collapse-content" id="bb-stats-section">
                        ${statsHTML}
                    </div>
                </div>`;
    }

    if (metadata) {
        // SECURITY (cleaned fork): metadata is rendered as HTML, so it must
        // be sanitized before insertion. See sanitizeMetadataHTML above.
        const safeMetadata = sanitizeMetadataHTML(metadata);
        if (safeMetadata) {
            html += `
                <div class="bot-browser-detail-section">
                    <h4>Metadata</h4>
                    <div class="bot-browser-detail-metadata">
                        ${safeMetadata}
                    </div>
                </div>`;
        }
    }

    return html;
}

function buildCollapsibleSection(id, title, content) {
    return `
                <div class="bot-browser-detail-section">
                    <button class="bot-browser-collapse-toggle" data-target="${id}">
                        <i class="fa-solid fa-chevron-right"></i>
                        <h4>${title}</h4>
                    </button>
                    <div class="bot-browser-collapse-content" id="${id}" style="display: none;">
                        <div class="bot-browser-detail-text">
                            ${content}
                        </div>
                    </div>
                </div>`;
}

function buildSection(title, content) {
    return `
                <div class="bot-browser-detail-section">
                    <h4>${title}</h4>
                    <div class="bot-browser-detail-text">
                        ${content}
                    </div>
                </div>`;
}

function buildAlternateGreetingsSection(alternateGreetings) {
    return `
                <div class="bot-browser-detail-section">
                    <h4>Alternate Greetings (${alternateGreetings.length})</h4>
                    ${alternateGreetings.map((greeting, index) => `
                        <div class="bot-browser-detail-greeting">
                            <div class="bot-browser-detail-greeting-header">
                                <i class="fa-solid fa-comment"></i> Greeting ${index + 1}
                            </div>
                            <div class="bot-browser-detail-text">
                                ${greeting}
                            </div>
                        </div>
                    `).join('')}
                </div>`;
}

function buildLorebookEntriesSection(entries, entriesCount) {
    return `
                <div class="bot-browser-detail-section">
                    <h4>Lorebook Entries (${entriesCount}) (Preview)</h4>
                    ${entries.map(entry => `
                        <div class="bot-browser-detail-section" style="margin-top: 15px; padding: 10px; background: rgba(255,255,255,0.05); border-radius: 5px;">
                            <h5 style="margin: 0 0 5px 0;">${entry.name}</h5>
                            ${entry.keywords && entry.keywords.length > 0 ? `
                                <div style="margin-bottom: 10px;">
                                    <strong style="font-size: 12px; color: rgba(255,255,255,0.6);">Keywords:</strong>
                                    ${entry.keywords.map(kw => `<span style="display: inline-block; background: rgba(100,150,255,0.2); padding: 2px 6px; border-radius: 3px; margin: 2px; font-size: 11px;">${kw}</span>`).join('')}
                                </div>
                            ` : ''}
                            <div class="bot-browser-detail-text">
                                ${entry.content}
                            </div>
                        </div>
                    `).join('')}
                </div>`;
}
