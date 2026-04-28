// ---------------------------------------------------------------------------
// SECURITY NOTE (cleaned fork):
//
// The upstream mia13165/SillyTavern-BotBrowser extension used this module to
// load a hardcoded "card archive" from an attacker-controlled GitHub repo
// (mia13165/updated_cards). Among the real-looking cards, the archive shipped
// a poisoned entry whose `metadata` field contained an <img onload="..."> tag
// that triggered a delayed fetch+eval of a remote loader, which in turn
// executed a Lua/Fengari credential harvester (stealing API keys, proxy
// passwords, reverse-proxy credentials, and full user backups from
// multi-user installs). See st-backdoor for details.
//
// Fixes applied in this file:
//   1. The hardcoded attacker URL (`mia13165/updated_cards`) is removed.
//      Any static-archive fetch is now disabled and returns empty data.
//   2. `loadMasterIndex()`, `loadServiceIndex()` fallback, and `loadCardChunk()`
//      no longer perform any outbound request to the attacker origin.
//   3. The `initializeServiceCache` / `findDefaultAvatarCard` / `pickCard` /
//      `cleanupModal` preload-and-silent-render chain (which was the
//      *delivery* vector for the poisoned card) has been removed entirely.
//   4. Live API sources (Chub, Character Tavern, Wyvern, MLPChag, JannyAI,
//      Quillgen, etc.) are untouched — they fetch directly from their real
//      origins and do not depend on the attacker repo.
//
// A parallel defense-in-depth fix in modules/templates/detailModal.js
// sanitizes any `metadata` HTML before it is inserted via innerHTML, so even
// if a poisoned card ever reached the detail modal it could not execute code.
// ---------------------------------------------------------------------------

import { loadQuillgenIndex } from './quillgenApi.js';
import { searchCharacterTavern, characterTavernApiState, resetCharacterTavernState } from './characterTavernApi.js';
import { loadMlpchagLive, clearMlpchagCache, getMlpchagApiState, resetMlpchagState } from './mlpchagApi.js';
import {
    loadWyvernCharacters, loadMoreWyvernCharacters, searchWyvernCharacters, transformWyvernCard,
    loadWyvernLorebooks, loadMoreWyvernLorebooks, searchWyvernLorebooks, transformWyvernLorebook,
    wyvernApiState, wyvernLorebooksApiState, resetWyvernApiState, resetWyvernLorebooksApiState,
    getWyvernApiState, getWyvernLorebooksApiState
} from './wyvernApi.js';

// Static archive is disabled in this cleaned fork.
// No network calls are made to any `baseUrl` below.
const STATIC_ARCHIVE_DISABLED = true;

// Storage for loaded data
const loadedData = {
    masterIndex: null,
    serviceIndexes: {},
    loadedChunks: {}
};

export async function loadMasterIndex() {
    // Static archive disabled in cleaned fork.
    // Previously fetched `${attackerBaseUrl}/index/master-index.json` which
    // served attacker-controlled content. Live API sources do not need this
    // index, so returning null is safe.
    loadedData.masterIndex = null;
    return null;
}

// Store Chub API state for pagination
const chubApiState = {
    currentPage: 1,
    hasMore: true,
    isLoading: false,
    currentSearch: '',
    currentSort: 'download_count'
};

export function getChubApiState() {
    return chubApiState;
}

export function resetChubApiState() {
    chubApiState.currentPage = 1;
    chubApiState.hasMore = true;
    chubApiState.isLoading = false;
    chubApiState.currentSearch = '';
    chubApiState.currentSort = 'download_count';
}

/**
 * Load more Chub cards (for infinite scroll)
 */
export async function loadMoreChubCards(options = {}) {
    if (chubApiState.isLoading || !chubApiState.hasMore) {
        return [];
    }

    chubApiState.isLoading = true;

    try {
        const { searchChubCards, transformChubCard } = await import('./chubApi.js');

        // Map sort options to Chub API sort values
        const sortMap = {
            'date_desc': 'created_at',
            'date_asc': 'created_at',
            'relevance': 'download_count',
            'name_asc': 'name',
            'name_desc': 'name'
        };

        const apiSort = sortMap[options.sort] || 'download_count';
        const isAsc = options.sort === 'date_asc' || options.sort === 'name_asc';

        // Update state with current search/sort
        if (options.search !== undefined) chubApiState.currentSearch = options.search;
        if (options.sort !== undefined) chubApiState.currentSort = options.sort;

        console.log(`[Bot Browser] Loading Chub page ${chubApiState.currentPage}, search: "${chubApiState.currentSearch}", sort: ${apiSort}`);

        const result = await searchChubCards({
            limit: 48,
            page: chubApiState.currentPage,
            search: chubApiState.currentSearch,
            sort: apiSort,
            asc: isAsc,
            // NSFW filter - if hideNsfw is true, tell API to exclude NSFW content
            nsfw: options.hideNsfw ? false : true,
            nsfl: options.hideNsfw ? false : true,
            // Advanced filters
            minTokens: options.minTokens,
            maxTokens: options.maxTokens,
            tags: options.customTags,
            excludeTags: options.excludeTags,
            username: options.creatorUsername,
            maxDaysAgo: options.maxDaysAgo,
            minAiRating: options.minAiRating,
            requireExamples: options.requireExamples,
            requireLore: options.requireLore,
            requireGreetings: options.requireGreetings
        });

        let nodes = [];
        if (Array.isArray(result)) {
            nodes = result;
        } else if (result && result.data && Array.isArray(result.data.nodes)) {
            // API returns { data: { nodes: [...], count, cursor } }
            nodes = result.data.nodes;
        } else if (result && Array.isArray(result.nodes)) {
            nodes = result.nodes;
        }

        const cards = nodes.map(transformChubCard);
        console.log(`[Bot Browser] Loaded ${cards.length} cards from Chub API page ${chubApiState.currentPage}`);

        // Check if there are more pages - use cursor if available, otherwise check count
        const hasCursor = result?.data?.cursor != null;
        if (cards.length < 48 && !hasCursor) {
            chubApiState.hasMore = false;
        } else {
            chubApiState.currentPage++;
        }

        // Append to existing cache
        if (!loadedData.serviceIndexes['chub']) {
            loadedData.serviceIndexes['chub'] = [];
        }
        loadedData.serviceIndexes['chub'].push(...cards);

        chubApiState.isLoading = false;
        return cards;
    } catch (error) {
        console.error('[Bot Browser] Failed to load more Chub cards:', error);
        chubApiState.isLoading = false;
        return [];
    }
}

// Store Chub Lorebooks API state for pagination
const chubLorebooksApiState = {
    currentPage: 1,
    hasMore: true,
    isLoading: false,
    currentSearch: '',
    currentSort: 'star_count'
};

export function getChubLorebooksApiState() {
    return chubLorebooksApiState;
}

export function resetChubLorebooksApiState() {
    chubLorebooksApiState.currentPage = 1;
    chubLorebooksApiState.hasMore = true;
    chubLorebooksApiState.isLoading = false;
    chubLorebooksApiState.currentSearch = '';
    chubLorebooksApiState.currentSort = 'star_count';
}

// Export Character Tavern API state helpers
export function getCharacterTavernApiState() {
    return characterTavernApiState;
}

export { resetCharacterTavernState };

/**
 * Load more Character Tavern cards (for pagination)
 */
export async function loadMoreCharacterTavernCards(options = {}) {
    if (characterTavernApiState.isLoading || !characterTavernApiState.hasMore) {
        return [];
    }

    try {
        console.log(`[Bot Browser] Loading Character Tavern page ${characterTavernApiState.page + 1}`);

        const cards = await searchCharacterTavern({
            query: options.search || '',
            page: characterTavernApiState.page + 1,
            limit: 30,
            hasLorebook: options.hasLorebook,
            isOC: options.isOC,
            minTokens: options.minTokens,
            maxTokens: options.maxTokens,
            tags: options.tags || []
        });

        // Append to cache
        if (!loadedData.serviceIndexes['character_tavern_live']) {
            loadedData.serviceIndexes['character_tavern_live'] = [];
        }
        loadedData.serviceIndexes['character_tavern_live'].push(...cards);

        return cards;
    } catch (error) {
        console.error('[Bot Browser] Failed to load more Character Tavern cards:', error);
        return [];
    }
}

/**
 * Load more Chub lorebooks (for infinite scroll)
 */
export async function loadMoreChubLorebooks(options = {}) {
    if (chubLorebooksApiState.isLoading || !chubLorebooksApiState.hasMore) {
        return [];
    }

    chubLorebooksApiState.isLoading = true;

    try {
        const { searchChubLorebooks, transformChubLorebook } = await import('./chubApi.js');

        // Map sort options to Chub API sort values
        const sortMap = {
            'date_desc': 'created_at',
            'date_asc': 'created_at',
            'relevance': 'star_count',
            'name_asc': 'name',
            'name_desc': 'name'
        };

        const apiSort = sortMap[options.sort] || 'star_count';
        const isAsc = options.sort === 'date_asc' || options.sort === 'name_asc';

        // Update state with current search/sort
        if (options.search !== undefined) chubLorebooksApiState.currentSearch = options.search;
        if (options.sort !== undefined) chubLorebooksApiState.currentSort = options.sort;

        console.log(`[Bot Browser] Loading Chub lorebooks page ${chubLorebooksApiState.currentPage}, search: "${chubLorebooksApiState.currentSearch}", sort: ${apiSort}`);

        const result = await searchChubLorebooks({
            limit: 48,
            page: chubLorebooksApiState.currentPage,
            search: chubLorebooksApiState.currentSearch,
            sort: apiSort,
            asc: isAsc,
            // NSFW filter - if hideNsfw is true, tell API to exclude NSFW content
            nsfw: options.hideNsfw ? false : true,
            nsfl: options.hideNsfw ? false : true,
            // Filters
            tags: options.customTags,
            excludeTags: options.excludeTags,
            username: options.creatorUsername
        });

        let nodes = [];
        if (Array.isArray(result)) {
            nodes = result;
        } else if (result && result.data && Array.isArray(result.data.nodes)) {
            nodes = result.data.nodes;
        } else if (result && Array.isArray(result.nodes)) {
            nodes = result.nodes;
        }

        const lorebooks = nodes.map(transformChubLorebook);
        console.log(`[Bot Browser] Loaded ${lorebooks.length} lorebooks from Chub API page ${chubLorebooksApiState.currentPage}`);

        // Check if there are more pages
        if (lorebooks.length < 48) {
            chubLorebooksApiState.hasMore = false;
        } else {
            chubLorebooksApiState.currentPage++;
        }

        // Append to existing cache
        if (!loadedData.serviceIndexes['chub_lorebooks']) {
            loadedData.serviceIndexes['chub_lorebooks'] = [];
        }
        loadedData.serviceIndexes['chub_lorebooks'].push(...lorebooks);

        chubLorebooksApiState.isLoading = false;
        return lorebooks;
    } catch (error) {
        console.error('[Bot Browser] Failed to load more Chub lorebooks:', error);
        chubLorebooksApiState.isLoading = false;
        return [];
    }
}

export async function loadServiceIndex(serviceName, useLiveApi = false, options = {}) {
    // Handle QuillGen specially - it uses API-based loading
    if (serviceName === 'quillgen') {
        // Return cached data if available
        if (loadedData.serviceIndexes['quillgen'] && loadedData.serviceIndexes['quillgen'].length > 0) {
            return loadedData.serviceIndexes['quillgen'];
        }
        const cards = await loadQuillgenIndex();
        loadedData.serviceIndexes['quillgen'] = cards;
        return cards;
    }

    // For chub_lorebooks with live API enabled, fetch from Gateway API
    if (serviceName === 'chub_lorebooks' && useLiveApi) {
        resetChubLorebooksApiState();
        delete loadedData.serviceIndexes[serviceName];

        try {
            const lorebooks = await loadMoreChubLorebooks(options);
            return lorebooks;
        } catch (error) {
            console.error('[Bot Browser] Chub Lorebooks API failed:', error);
            // Fall through to archive method below
        }
    }

    // For chub with live API enabled, always fetch fresh from API (don't use cache)
    // This ensures users get the latest cards
    if (serviceName === 'chub' && useLiveApi) {
        // Reset pagination state for fresh load
        resetChubApiState();

        // Clear any cached chub data to ensure fresh API results
        delete loadedData.serviceIndexes[serviceName];

        try {
            // Load first page
            const cards = await loadMoreChubCards(options);
            return cards;
        } catch (error) {
            console.error('[Bot Browser] Chub API failed:', error);
            console.error('[Bot Browser] Error stack:', error.stack);
            // Fall through to archive method below
        }
    }

    // For character_tavern with live API enabled, fetch from Character Tavern API
    if (serviceName === 'character_tavern' && useLiveApi) {
        resetCharacterTavernState();
        delete loadedData.serviceIndexes['character_tavern_live'];

        try {
            console.log('[Bot Browser] Loading Character Tavern via live API');
            const cards = await searchCharacterTavern({
                query: options.search || '',
                page: 1,
                limit: 30,
                hasLorebook: options.hasLorebook,
                isOC: options.isOC,
                minTokens: options.minTokens,
                maxTokens: options.maxTokens,
                tags: options.tags || []
            });
            loadedData.serviceIndexes['character_tavern_live'] = cards;
            return cards;
        } catch (error) {
            console.error('[Bot Browser] Character Tavern API failed:', error);
            // Fall through to archive method below
        }
    }

    // For mlpchag with live API enabled, fetch from MLPChag API
    if (serviceName === 'mlpchag' && useLiveApi) {
        resetMlpchagState();
        delete loadedData.serviceIndexes['mlpchag_live'];

        try {
            console.log('[Bot Browser] Loading MLPChag via live API');
            const cards = await loadMlpchagLive();
            loadedData.serviceIndexes['mlpchag_live'] = cards;
            return cards;
        } catch (error) {
            console.error('[Bot Browser] MLPChag API failed:', error);
            // Fall through to archive method below
        }
    }

    // For wyvern with live API enabled, fetch from Wyvern Chat API
    if (serviceName === 'wyvern' && useLiveApi) {
        resetWyvernApiState();
        delete loadedData.serviceIndexes['wyvern_live'];

        try {
            console.log('[Bot Browser] Loading Wyvern via live API');
            const cards = await loadWyvernCharacters({
                sort: options.sort || 'votes',
                order: options.order || 'DESC',
                search: options.search || '',
                tags: options.tags || [],
                rating: options.rating,
                hideNsfw: options.hideNsfw || false
            });
            loadedData.serviceIndexes['wyvern_live'] = cards;
            return cards;
        } catch (error) {
            console.error('[Bot Browser] Wyvern API failed:', error);
            // Fall through to return empty (no archive for Wyvern)
            return [];
        }
    }

    // For wyvern_lorebooks with live API enabled, fetch from Wyvern Chat API
    if (serviceName === 'wyvern_lorebooks' && useLiveApi) {
        resetWyvernLorebooksApiState();
        delete loadedData.serviceIndexes['wyvern_lorebooks_live'];

        try {
            console.log('[Bot Browser] Loading Wyvern Lorebooks via live API');
            const lorebooks = await loadWyvernLorebooks({
                sort: options.sort || 'created_at',
                order: options.order || 'DESC',
                search: options.search || '',
                tags: options.tags || [],
                rating: options.rating,
                hideNsfw: options.hideNsfw || false
            });
            loadedData.serviceIndexes['wyvern_lorebooks_live'] = lorebooks;
            return lorebooks;
        } catch (error) {
            console.error('[Bot Browser] Wyvern Lorebooks API failed:', error);
            return [];
        }
    }

    // Return cached data if available (for non-chub or when API fails)
    if (loadedData.serviceIndexes[serviceName]) {
        return loadedData.serviceIndexes[serviceName];
    }

    // Static archive is disabled in cleaned fork. The original code here
    // fetched an archive index from the attacker-controlled `baseUrl` and
    // fed the cards into the UI. That was the delivery vector for the
    // poisoned "default avatar" card. Archive snapshots now return empty,
    // but all live API sources continue to work normally above.
    if (STATIC_ARCHIVE_DISABLED) {
        console.info(`[Bot Browser] Static archive fallback for "${serviceName}" is disabled (cleaned fork).`);
        loadedData.serviceIndexes[serviceName] = [];
        return [];
    }

    loadedData.serviceIndexes[serviceName] = [];
    return [];
}

/**
 * Clear QuillGen cache to force reload on next access.
 */
export function clearQuillgenCache() {
    loadedData.serviceIndexes['quillgen'] = null;
}

export async function loadCardChunk(service, chunkFile) {
    // Static archive disabled in cleaned fork.
    // Original code fetched `${attackerBaseUrl}/chunks/${service}/${chunkFile}`
    // which is the exact path that served the poisoned
    // `chunks/anchorhold/page-4.json` card. Downstream callers
    // (modules/modals/detail.js, modules/services/import.js) already handle
    // an empty response gracefully by falling back to the card data the user
    // already has.
    if (STATIC_ARCHIVE_DISABLED) {
        return [];
    }
    return [];
}

// NOTE: The former `initializeServiceCache(showCardDetailFunc)` entry point
// (and its helpers `pickCard`, `findDefaultAvatarCard`, `cleanupModal`) has
// been removed in this cleaned fork.
//
// That function used to: (a) preload the attacker archive on every page load,
// (b) find a card whose image matched SillyTavern's default avatar, and
// (c) silently render it through the detail modal (for ~10ms, then clean it
// up before the user ever saw it) so the poisoned `<img onload=...>` inside
// `metadata` could fire via innerHTML. Removing this chain completely removes
// the delivery vector. The extension still works without it.
//
// `index.js` has been updated accordingly (no more `cache()` call on init).

// Export loaded data for other modules
export function getMasterIndex() {
    return loadedData.masterIndex;
}

export function getServiceIndex(serviceName) {
    return loadedData.serviceIndexes[serviceName];
}

export function getLoadedChunk(service, chunkFile) {
    const chunkKey = `${service}/${chunkFile}`;
    return loadedData.loadedChunks[chunkKey];
}

// Re-export MLPChag API helpers
export { clearMlpchagCache, getMlpchagApiState, resetMlpchagState };

// Re-export Wyvern API helpers
export { getWyvernApiState, getWyvernLorebooksApiState, resetWyvernApiState, resetWyvernLorebooksApiState };

/**
 * Load more Wyvern cards (for pagination)
 */
export async function loadMoreWyvernCards(options = {}) {
    if (wyvernApiState.isLoading || !wyvernApiState.hasMore) {
        return [];
    }

    try {
        console.log(`[Bot Browser] Loading Wyvern page ${wyvernApiState.page + 1}`);

        const cards = await loadMoreWyvernCharacters({
            sort: options.sort || wyvernApiState.lastSort,
            order: options.order || wyvernApiState.lastOrder,
            search: options.search ?? wyvernApiState.lastSearch,
            tags: options.tags || [],
            hideNsfw: options.hideNsfw || false
        });

        // Append to cache
        if (!loadedData.serviceIndexes['wyvern_live']) {
            loadedData.serviceIndexes['wyvern_live'] = [];
        }
        loadedData.serviceIndexes['wyvern_live'].push(...cards);

        return cards;
    } catch (error) {
        console.error('[Bot Browser] Failed to load more Wyvern cards:', error);
        return [];
    }
}

/**
 * Load more Wyvern lorebooks (for pagination)
 */
export async function loadMoreWyvernLorebooksWrapper(options = {}) {
    if (wyvernLorebooksApiState.isLoading || !wyvernLorebooksApiState.hasMore) {
        return [];
    }

    try {
        console.log(`[Bot Browser] Loading Wyvern Lorebooks page ${wyvernLorebooksApiState.page + 1}`);

        const lorebooks = await loadMoreWyvernLorebooks({
            sort: options.sort || wyvernLorebooksApiState.lastSort,
            order: options.order || wyvernLorebooksApiState.lastOrder,
            search: options.search ?? wyvernLorebooksApiState.lastSearch,
            hideNsfw: options.hideNsfw || false
        });

        // Append to cache
        if (!loadedData.serviceIndexes['wyvern_lorebooks_live']) {
            loadedData.serviceIndexes['wyvern_lorebooks_live'] = [];
        }
        loadedData.serviceIndexes['wyvern_lorebooks_live'].push(...lorebooks);

        return lorebooks;
    } catch (error) {
        console.error('[Bot Browser] Failed to load more Wyvern lorebooks:', error);
        return [];
    }
}
