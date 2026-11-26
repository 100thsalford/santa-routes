// FILE: analytics.js (root folder - same level as index.html)
(function() {
    'use strict';

    // Optional analytics are controlled by privacy-prefs.js (loaded first).
    // Fail closed: if that script didn't load, send nothing.
    function analyticsAllowed() {
        return !!(window.SSSPrivacy && window.SSSPrivacy.analyticsEnabled());
    }
    
    // Analytics tracking function
    function trackEvent(eventType, eventData = {}) {
        if (!analyticsAllowed()) return;
        // Don't track in development
        if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
            console.log('DEV - Would track:', eventType, eventData);
            return;
        }

        try {
            fetch('/.netlify/functions/log-analytics', {
                method: 'POST',
                keepalive: true, // still sent if a click navigates away straight after
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    eventType,
                    eventData,
                    page: window.location.pathname
                })
            }).catch(err => {
                // Silently fail - don't interrupt user experience
                console.debug('Analytics error:', err);
            });
        } catch (e) {
            // Silently fail
        }
    }

    // Enhanced search logging function
    function logSearch(searchTerm, matchFound, matchedStreet = null, resultsCount = 0) {
        if (!analyticsAllowed()) return;
        // Don't track in development
        if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
            console.log('DEV - Would log search:', { searchTerm, matchFound, matchedStreet, resultsCount });
            return;
        }

        try {
            fetch('/.netlify/functions/log-search', {
                method: 'POST',
                keepalive: true, // still sent if this fires as the page closes
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    searchTerm,
                    matchFound,
                    matchedStreet,
                    resultsCount,
                    page: window.location.pathname
                })
            }).catch(err => {
                console.debug('Search logging error:', err);
            });
        } catch (e) {
            // Silently fail
        }
    }

    // Track page view on load
    window.addEventListener('load', function() {
        trackEvent('page_view', {
            title: document.title,
            url: window.location.pathname
        });
    });

    // Track street searches with enhanced logging
    const streetInput = document.getElementById('streetInput');
    if (streetInput) {
        let searchTimeout;
        
        // Store reference to the original search function if it exists
        const originalPerformSearch = window.performSearch;
        
        // Override or wrap the search function to capture results
        if (typeof window.performSearch === 'function') {
            window.performSearch = function() {
                const searchTerm = streetInput.value.trim();
                
                // Call original search function
                const result = originalPerformSearch.apply(this, arguments);
                
                // Wait a moment for results to be rendered, then check for matches
                setTimeout(function() {
                    const resultsContainer = document.getElementById('results');
                    const noResultsMessage = document.querySelector('.no-results');
                    
                    if (resultsContainer) {
                        const resultCards = resultsContainer.querySelectorAll('.street-card');
                        const matchFound = resultCards.length > 0;
                        const resultsCount = resultCards.length;
                        
                        // Get the first matched street name if available
                        let matchedStreet = null;
                        if (matchFound && resultCards[0]) {
                            const streetNameElement = resultCards[0].querySelector('.street-name');
                            if (streetNameElement) {
                                matchedStreet = streetNameElement.textContent.trim();
                            }
                        }
                        
                        // Log the search with results
                        logSearch(searchTerm, matchFound, matchedStreet, resultsCount);
                    } else if (noResultsMessage && !noResultsMessage.classList.contains('hidden')) {
                        // No results found
                        logSearch(searchTerm, false, null, 0);
                    }
                }, 100);
                
                return result;
            };
        }
        
        // Fallback: Basic input tracking (if performSearch doesn't exist)
        streetInput.addEventListener('input', function(e) {
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(function() {
                if (e.target.value.length >= 2) {
                    // Only note that a search happened; what was typed is never sent here
                    // (searches are logged, minimised, through logSearch instead).
                    trackEvent('street_search');
                }
            }, 2000); // Only log after user stops typing for 2 seconds
        });
    }

    // Track date searches
    const dateInput = document.getElementById('dateInput');
    if (dateInput) {
        dateInput.addEventListener('change', function(e) {
            trackEvent('date_search', {
                date: e.target.value
            });
        });
    }

    // Track tab switches
    const tabButtons = document.querySelectorAll('.tab-btn');
    tabButtons.forEach(function(btn) {
        btn.addEventListener('click', function() {
            trackEvent('tab_switch', {
                tab: btn.dataset.tab
            });
        });
    });

    // Track report sighting modal opens
    const reportButtons = document.querySelectorAll('#reportSightingBtn, #reportSightingBtn2');
    reportButtons.forEach(function(btn) {
        btn.addEventListener('click', function() {
            trackEvent('report_sighting_opened', {
                buttonId: btn.id
            });
        });
    });

    // Track sighting submissions
    const sightingForm = document.getElementById('sightingForm');
    if (sightingForm) {
        sightingForm.addEventListener('submit', function() {
            trackEvent('sighting_submitted');
        });
    }

    // Track modal opens
    const allRoutesButtons = document.querySelectorAll('#allRoutesBtn, #allRoutesBtnMobile');
    allRoutesButtons.forEach(function(btn) {
        btn.addEventListener('click', function() {
            trackEvent('all_routes_opened');
        });
    });

    // Track map link clicks
    const mapLinks = document.querySelectorAll('a[href="map.html"]');
    mapLinks.forEach(function(link) {
        link.addEventListener('click', function() {
            trackEvent('map_opened');
        });
    });

    // Track about page link clicks
    const aboutLinks = document.querySelectorAll('a[href="about.html"]');
    aboutLinks.forEach(function(link) {
        link.addEventListener('click', function() {
            trackEvent('about_opened');
        });
    });

    // Track donation button clicks
    const donateButtons = document.querySelectorAll('.donate-btn, .cta-btn.primary');
    donateButtons.forEach(function(btn) {
        btn.addEventListener('click', function() {
            trackEvent('donation_clicked');
        });
    });

    // Track Facebook link clicks
    const fbLinks = document.querySelectorAll('.fb-link, .cta-btn.secondary');
    fbLinks.forEach(function(link) {
        link.addEventListener('click', function() {
            trackEvent('facebook_clicked');
        });
    });

    // Track mobile menu interactions
    const menuButtons = document.querySelectorAll('.menu-btn');
    menuButtons.forEach(function(btn) {
        btn.addEventListener('click', function() {
            const section = btn.dataset.section || 'external_link';
            trackEvent('mobile_menu_click', {
                section: section
            });
        });
    });

    // Track "Track Santa Live" floating button clicks
    const trackSantaFloatBtn = document.getElementById('trackSantaFloatBtn');
    if (trackSantaFloatBtn) {
        trackSantaFloatBtn.addEventListener('click', function() {
            trackEvent('track_santa_live_clicked', {
                button_type: 'floating_button',
                destination: 'glympse'
            });
        });
    }

    // Time spent looking at the page (only time with the tab visible counts).
    // Rather than a ping every minute -- one function call per visitor per
    // minute -- the visible time is sent once each time the page is hidden:
    // the visitor switches tab or app, locks the phone, navigates away or
    // closes it. 'visibilitychange' is what mobile browsers reliably fire in
    // all of those cases (beforeunload often doesn't fire on phones), and
    // sendBeacon is still delivered as the page closes. Each 'visible_time'
    // event is the visible seconds since the last one, so a visit's events
    // add up to its total; under 10 seconds is carried over, not sent.
    // (Before 2026-11-26 this sent 'time_on_page' every minute with a
    // running total, plus 'page_exit' on beforeunload.)
    let visibleSince = document.hidden ? null : Date.now();
    let unreportedMs = 0;

    function reportVisibleTime() {
        if (visibleSince !== null) {
            unreportedMs += Date.now() - visibleSince;
            visibleSince = null;
        }
        const seconds = Math.round(unreportedMs / 1000);
        if (seconds < 10 || !analyticsAllowed()) return;
        unreportedMs = 0;
        if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
            console.log('DEV - Would track: visible_time', { seconds });
            return;
        }
        const url = '/.netlify/functions/log-analytics';
        const body = JSON.stringify({
            eventType: 'visible_time',
            eventData: { seconds },
            page: window.location.pathname
        });
        let queued = false;
        try { queued = !!(navigator.sendBeacon && navigator.sendBeacon(url, body)); } catch (e) { /* fall through */ }
        if (!queued) {
            try {
                fetch(url, { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json' }, body })
                    .catch(function() {});
            } catch (e) { /* silently fail */ }
        }
    }

    document.addEventListener('visibilitychange', function() {
        if (document.hidden) reportVisibleTime();
        else if (visibleSince === null) visibleSince = Date.now();
    });
    window.addEventListener('pagehide', reportVisibleTime);
    // Coming back to a page from the browser's back/forward cache.
    window.addEventListener('pageshow', function() {
        if (!document.hidden && visibleSince === null) visibleSince = Date.now();
    });

    // Make functions available globally for custom tracking
    window.trackEvent = trackEvent;
    window.logSearch = logSearch;
})();