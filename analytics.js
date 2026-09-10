// FILE: analytics.js (root folder - same level as index.html)
(function() {
    'use strict';
    
    // Analytics tracking function
    function trackEvent(eventType, eventData = {}) {
        // Don't track in development
        if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
            console.log('DEV - Would track:', eventType, eventData);
            return;
        }

        try {
            fetch('/.netlify/functions/log-analytics', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    eventType,
                    eventData,
                    page: window.location.pathname,
                    referrer: document.referrer
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
        // Don't track in development
        if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
            console.log('DEV - Would log search:', { searchTerm, matchFound, matchedStreet, resultsCount });
            return;
        }

        try {
            fetch('/.netlify/functions/log-search', {
                method: 'POST',
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
            url: window.location.href
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
                    trackEvent('street_search', {
                        query: e.target.value.substring(0, 50) // Limit length for privacy
                    });
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

    // Track time on page (ping every 30 seconds)
    let timeOnPage = 0;
    setInterval(function() {
        timeOnPage += 30;
        if (timeOnPage % 60 === 0) { // Log every minute
            trackEvent('time_on_page', {
                seconds: timeOnPage
            });
        }
    }, 30000);

    // Track when user leaves (if they stay more than 10 seconds)
    window.addEventListener('beforeunload', function() {
        if (timeOnPage >= 10) {
            navigator.sendBeacon(
                '/.netlify/functions/log-analytics',
                JSON.stringify({
                    eventType: 'page_exit',
                    eventData: { timeOnPage },
                    page: window.location.pathname
                })
            );
        }
    });

    // Make functions available globally for custom tracking
    window.trackEvent = trackEvent;
    window.logSearch = logSearch;
})();