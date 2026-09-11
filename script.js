// Global state
let routesData = [];
let currentTab = 'street';
let selectedStreet = '';

// Cached result of /.netlify/functions/get-site-status -- the single
// source of truth for "is the season live / are sightings active right
// now", replacing the old scattered hardcoded date/time checks. Kept
// fresh via a periodic refresh so time-window based UI (like the report
// button) still updates correctly for a page left open across a window
// boundary (e.g. 10pm cutoff).
let siteStatus = null;

async function refreshSiteStatus() {
    try {
        const params = new URLSearchParams(window.location.search);
        const asOf = params.get('asOf');
        let url = '/.netlify/functions/get-site-status';
        if (asOf) {
            url += '?asOf=' + encodeURIComponent(asOf);
        }
        const response = await fetch(url);
        siteStatus = await response.json();
    } catch (error) {
        console.error('Error fetching site status:', error);
    }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', async function() {
    console.log('DOM loaded, initializing...');

    // Fetch site status first so everything date/time-gated below has it
    // available on first render, then keep it refreshed every minute.
    await refreshSiteStatus();
    setInterval(refreshSiteStatus, 60000);

    // Initialize main search features
    initializeTabs();
    loadRoutes();
    initializeModal();

    // Initialize sightings feature
    initializeSightingsFeature();

    // Initialize disclaimer toggle
    initializeDisclaimerToggle();

    // Initialize mobile navigation
    initializeMobileNavigation();
});

function initializeMobileNavigation() {
    const mobileMenu = document.getElementById('mobileMenu');
    const menuButtons = document.querySelectorAll('.menu-btn');
    const backButtons = document.querySelectorAll('.back-btn');
    const contentSections = document.querySelectorAll('.content-section');
    
    // Menu button clicks
    menuButtons.forEach(function(btn) {
        btn.addEventListener('click', function() {
            const sectionId = btn.dataset.section;
            const tabToActivate = btn.dataset.tab;
            
            if (!sectionId) return; // For donation button
            
            // Hide menu
            mobileMenu.classList.add('hidden');
            
            // Show selected section
            contentSections.forEach(function(section) {
                section.classList.remove('active');
            });
            
            const targetSection = document.getElementById(sectionId);
            if (targetSection) {
                targetSection.classList.add('active');
                
                // If date tab requested, switch to it
                if (tabToActivate === 'date') {
                    switchTab('date');
                    document.querySelectorAll('.tab-btn').forEach(function(tb) {
                        tb.classList.remove('active');
                    });
                    document.querySelectorAll('.tab-btn')[1].classList.add('active');
                }
                
                // Scroll to top
                window.scrollTo({ top: 0, behavior: 'smooth' });
            }
        });
    });
    
    // Back button clicks
    backButtons.forEach(function(btn) {
        btn.addEventListener('click', function() {
            // Hide all sections
            contentSections.forEach(function(section) {
                section.classList.remove('active');
            });
            
            // Show menu
            mobileMenu.classList.remove('hidden');
            
            // Scroll to top
            window.scrollTo({ top: 0, behavior: 'smooth' });
        });
    });
}

function initializeDisclaimerToggle() {
    const toggleBtn = document.getElementById('disclaimerToggle');
    const content = document.getElementById('disclaimerContent');
    const arrow = toggleBtn.querySelector('.disclaimer-arrow');
    const toggleText = document.getElementById('disclaimerToggleText');
    
    if (!toggleBtn || !content) return;
    
    toggleBtn.addEventListener('click', function() {
        content.classList.toggle('expanded');
        arrow.classList.toggle('rotated');
        
        if (content.classList.contains('expanded')) {
            toggleText.textContent = 'Read less';
        } else {
            toggleText.textContent = 'Read more';
        }
    });
}

function initializeSightingsFeature() {
    console.log('Initializing sightings feature...');
    
    // Check if elements exist
    const sightingModal = document.getElementById('sightingModal');
    
    if (!sightingModal) {
        console.error('Sighting elements not found!');
        return;
    }
    
    console.log('Sighting elements found, setting up...');
    
    // Load sightings
    loadSightings();
    
    // Setup modal
    initializeSightingModal();
}

// Tab switching
function initializeTabs() {
    const tabButtons = document.querySelectorAll('.tab-btn');
    
    tabButtons.forEach(function(btn) {
        btn.addEventListener('click', function() {
            const tab = btn.dataset.tab;
            switchTab(tab);
            
            // Update button states
            tabButtons.forEach(function(b) {
                b.classList.remove('active');
            });
            btn.classList.add('active');
        });
    });
}

function switchTab(tab) {
    currentTab = tab;
    const resultsArea = document.getElementById('resultsArea');
    
    // Show/hide search inputs
    const streetSearch = document.getElementById('street-search');
    const dateSearch = document.getElementById('date-search');
    
    if (streetSearch) streetSearch.style.display = tab === 'street' ? 'block' : 'none';
    if (dateSearch) dateSearch.style.display = tab === 'date' ? 'block' : 'none';
    
    // Clear results
    if (resultsArea) {
        resultsArea.classList.remove('show');
        resultsArea.innerHTML = '<div class="loading">Start typing to search...</div>';
    }
}

// Load routes from Netlify function
async function loadRoutes() {
    const resultsArea = document.getElementById('resultsArea');
    
    try {
        const response = await fetch('/.netlify/functions/get-routes');
        const data = await response.json();
        
        if (data.success) {
            routesData = data.routes;
            console.log('Routes loaded:', routesData.length);
            setupSearchListeners();
            loadTodaysStreets(); // Load today's streets after routes are loaded
        } else {
            throw new Error(data.error || 'Failed to load routes');
        }
    } catch (error) {
        console.error('Error loading routes:', error);
        if (resultsArea) {
            resultsArea.innerHTML = '<div class="no-results">Unable to load routes. Please try refreshing the page.</div>';
        }
    }
}

// NEW: Load and display today's streets
function loadTodaysStreets() {
    const container = document.getElementById('todaysStreetsContent');
    if (!container) return;
    
    // Get today's date in YYYY-MM-DD format
    const todayString = (siteStatus && siteStatus.todayDate) || new Date().toISOString().split('T')[0];
    
    // Filter routes for today
    const todaysRoutes = routesData.filter(function(item) {
        return item.date === todayString;
    });
    
    if (todaysRoutes.length > 0) {
        // Sort by street number
        todaysRoutes.sort(function(a, b) {
            const getNumber = function(str) {
                const match = str.match(/^(\d+)/);
                return match ? parseInt(match[1]) : 999999;
            };
            return getNumber(a.street) - getNumber(b.street);
        });
        
        // Get the route name and date from the first item (all same route/date)
        const routeName = todaysRoutes[0].route;
        const routeDate = todaysRoutes[0].date;
        
        // Display route info header + streets with times
        const headerHtml = '<div class="route-group"><div class="route-title">' + formatDate(routeDate) + '</div><div class="route-subtitle">' + escapeHtml(routeName) + '</div></div>';
        
        const streetsHtml = todaysRoutes.map(function(item) {
            const timeDisplay = item.time ? '<span style="color: #165b33; margin-left: 0.5rem;">🕐 Approx. ' + escapeHtml(item.time) + '</span>' : '';
            return '<div class="street-list-item">' + escapeHtml(item.street) + timeDisplay + '</div>';
        }).join('');
        
        container.innerHTML = headerHtml + '<div class="streets-list-view">' + streetsHtml + '</div>';
    } else {
        // No routes today, find next available date
        const nextDate = findNextAvailableDate();
        
        if (nextDate) {
            const formattedDate = formatDate(nextDate);
            container.innerHTML = '<div style="text-align: center; padding: 2rem; color: #666; line-height: 1.6;"><strong style="display: block; font-size: 1.1rem; margin-bottom: 0.5rem;">🎅</strong>Santa returns ' + formattedDate + '</div>';
        } else {
            container.innerHTML = '<div style="text-align: center; padding: 2rem; color: #666;">🎅 No upcoming routes scheduled</div>';
        }
    }
}

// Find next available date from routes
function findNextAvailableDate() {
    if (routesData.length === 0) return null;
    
    const todayString = (siteStatus && siteStatus.todayDate) || new Date().toISOString().split('T')[0];
    
    // Get all unique dates and sort them
    const dates = [...new Set(routesData.map(r => r.date))].sort();
    
    // Find first date after today
    for (let date of dates) {
        if (date > todayString) {
            return date;
        }
    }
    
    return null;
}

// Display today's streets
function displayTodaysStreets(routes) {
    const container = document.getElementById('todaysStreetsContent');
    if (!container) return;
    
    // Sort by street number (same as All Routes modal)
    routes.sort(function(a, b) {
        const getNumber = function(str) {
            const match = str.match(/^(\d+)/);
            return match ? parseInt(match[1]) : 999999;
        };
        return getNumber(a.street) - getNumber(b.street);
    });
    
    // Group by route
    const grouped = {};
    routes.forEach(function(item) {
        if (!grouped[item.route]) {
            grouped[item.route] = [];
        }
        grouped[item.route].push(item);
    });
    
    let html = '';
    
    for (let route in grouped) {
        const routeItems = grouped[route];
        
        html += '<div class="route-group-compact">';
        html += '<div class="route-subtitle-compact">' + escapeHtml(route) + '</div>';
        html += '<div class="streets-list-view">';
        
        routeItems.forEach(function(item) {
            const timeDisplay = item.time ? '<span style="color: #165b33; margin-left: 0.5rem;">🕐 Approx. ' + escapeHtml(item.time) + '</span>' : '';
            html += '<div class="street-list-item">' + escapeHtml(item.street) + timeDisplay + '</div>';
        });
        
        html += '</div></div>';
    }
    
    container.innerHTML = html;
}

// Normalize street names for better search matching
function normalizeStreetName(streetName) {
    let normalized = streetName.toLowerCase().trim();
    
    // Common abbreviations mapping
    const abbreviations = {
        // Road variations
        'road': ['rd', 'r'],
        'rd': ['road', 'r'],
        // Avenue variations
        'avenue': ['ave', 'av', 'avn'],
        'ave': ['avenue', 'av', 'avn'],
        'av': ['avenue', 'ave', 'avn'],
        // Street variations (but not at the start for "Saint")
        'street': ['st', 'str'],
        'st': ['street', 'str'],
        // Drive variations
        'drive': ['dr', 'drv'],
        'dr': ['drive', 'drv'],
        // Close variations
        'close': ['cl', 'cls'],
        'cl': ['close', 'cls'],
        // Court variations
        'court': ['ct', 'crt'],
        'ct': ['court', 'crt'],
        // Lane variations
        'lane': ['ln'],
        'ln': ['lane'],
        // Place variations
        'place': ['pl', 'plc'],
        'pl': ['place', 'plc'],
        // Crescent variations
        'crescent': ['cres', 'cr', 'crs'],
        'cres': ['crescent', 'cr', 'crs'],
        'cr': ['crescent', 'cres', 'crs'],
        // Gardens variations
        'gardens': ['gdns', 'gdn', 'gardn'],
        'gdns': ['gardens', 'gdn', 'gardn'],
        // Terrace variations
        'terrace': ['ter', 'terr', 'tce'],
        'ter': ['terrace', 'terr', 'tce'],
        // Grove variations
        'grove': ['grv', 'gro'],
        'grv': ['grove', 'gro'],
        // Mount variations
        'mount': ['mt'],
        'mt': ['mount'],
        // Square variations
        'square': ['sq', 'sqr'],
        'sq': ['square', 'sqr'],
        // Walk variations
        'walk': ['wlk'],
        'wlk': ['walk'],
        // Way variations
        'way': ['wy'],
        'wy': ['way']
    };
    
    return { normalized, abbreviations };
}

// Check if query matches street name (with abbreviation support)
function streetMatches(streetName, query) {
    // Use searchable name (without numbers) for matching
    const searchableStreet = getSearchableStreetName(streetName).toLowerCase();
    const searchQuery = query.toLowerCase().trim();
    
    // Direct match
    if (searchableStreet.includes(searchQuery)) {
        return true;
    }
    
    // Get normalized versions
    const streetData = normalizeStreetName(searchableStreet);
    const queryData = normalizeStreetName(searchQuery);
    
    // Split into words for smarter matching
    const streetWords = searchableStreet.split(/\s+/);
    const queryWords = searchQuery.split(/\s+/);
    
    // Try to match with abbreviation expansion
    for (let i = 0; i < queryWords.length; i++) {
        const queryWord = queryWords[i];
        
        // Check if this word has abbreviations
        if (streetData.abbreviations[queryWord]) {
            // Create variations of the query with expanded abbreviations
            const variations = streetData.abbreviations[queryWord];
            
            for (let variation of variations) {
                // Replace the query word with the variation
                const expandedQuery = queryWords.map((w, idx) => 
                    idx === i ? variation : w
                ).join(' ');
                
                if (searchableStreet.includes(expandedQuery)) {
                    return true;
                }
            }
        }
    }
    
    // Also try matching street abbreviations to query full words
    for (let i = 0; i < streetWords.length; i++) {
        const streetWord = streetWords[i];
        
        // Skip "St" at the beginning (likely "Saint")
        if (i === 0 && streetWord === 'st') {
            continue;
        }
        
        // Check if this street word has abbreviations
        if (queryData.abbreviations[streetWord]) {
            const variations = queryData.abbreviations[streetWord];
            
            for (let variation of variations) {
                const expandedStreet = streetWords.map((w, idx) => 
                    idx === i ? variation : w
                ).join(' ');
                
                if (expandedStreet.includes(searchQuery)) {
                    return true;
                }
            }
        }
    }
    
    return false;
}

// Remove house numbers and common prefixes from search queries
function cleanSearchQuery(query) {
    let cleaned = query.toLowerCase().trim();
    
    // Remove leading house numbers (e.g., "24 park lane" → "park lane")
    cleaned = cleaned.replace(/^\d+[a-z]?\s+/, '');
    
    // Remove common address prefixes (e.g., "flat 5, park lane" → "park lane")
    cleaned = cleaned.replace(/^(flat|apartment|apt|unit)\s*\d+[a-z]?\s*,?\s*/i, '');
    
    // Remove number ranges (e.g., "24-26 park lane" → "park lane")
    cleaned = cleaned.replace(/^\d+[a-z]?-\d+[a-z]?\s+/, '');
    
    return cleaned.trim();
}

// Setup search listeners
function setupSearchListeners() {
    const streetInput = document.getElementById('streetInput');
    const dateInput = document.getElementById('dateInput');
    const resultsArea = document.getElementById('resultsArea');
    
    if (!streetInput || !dateInput || !resultsArea) return;
    
    // Set date picker min/max based on available routes
    if (routesData.length > 0) {
        const dates = routesData.map(r => r.date).sort();
        const minDate = dates[0];
        const maxDate = dates[dates.length - 1];
        
        dateInput.setAttribute('min', minDate);
        dateInput.setAttribute('max', maxDate);
        
        // Set a helpful title
        const minDateFormatted = formatDate(minDate);
        const maxDateFormatted = formatDate(maxDate);
        dateInput.title = `Select a date between ${minDateFormatted} and ${maxDateFormatted}`;
    }
    
    // Street search with smart matching
    streetInput.addEventListener('input', function(e) {
        const query = e.target.value.toLowerCase().trim();
        
        if (query.length < 2) {
            resultsArea.classList.remove('show');
            resultsArea.innerHTML = '<div class="loading">Start typing to search...</div>';
            return;
        }

        // 🆕 Clean the query - remove house numbers and address prefixes
        const cleanQuery = cleanSearchQuery(query);
        
        // If cleaning removed everything, use original query
        const searchQuery = cleanQuery.length >= 2 ? cleanQuery : query;

        const results = routesData.filter(function(item) {
            return streetMatches(item.street, searchQuery);
        });

        displayResults(results, 'street');
        
        // 🎅 LOG THE SEARCH - Track search terms and results for analytics
        if (typeof window.logSearch === 'function') {
            const matchFound = results.length > 0;
            const firstMatch = matchFound ? getCleanStreetName(results[0].street) : null;
            const resultsCount = results.length;
            
            // Log with a small delay to avoid logging every keystroke
            clearTimeout(window.searchLogTimeout);
            window.searchLogTimeout = setTimeout(function() {
                // Log the cleaned query (without house number) for better analytics
                window.logSearch(searchQuery, matchFound, firstMatch, resultsCount);
            }, 1000); // Wait 1 second after user stops typing
        }
    });

    // Date search
    dateInput.addEventListener('change', function(e) {
        const selectedDate = e.target.value;
        
        if (!selectedDate) return;

        // Check if selected date has routes
        const results = routesData.filter(function(item) {
            return item.date === selectedDate;
        });

        // On iOS, min/max don't work, so validate manually
        if (results.length === 0) {
            // Show helpful message
            resultsArea.classList.add('show');
            resultsArea.innerHTML = '<div class="no-results">😕 No routes scheduled for this date.<br>Please select a different date or search by street.</div>';
            return;
        }

        displayResults(results, 'date');
    });

    // Clear initial loading message
    resultsArea.innerHTML = '<div class="loading">Start typing to search...</div>';
}

// Display search results
function displayResults(results, searchType) {
    const resultsArea = document.getElementById('resultsArea');
    if (!resultsArea) return;
    
    resultsArea.classList.add('show');

    if (results.length === 0) {
        resultsArea.innerHTML = '<div class="no-results">😕 No matches found in our routes, meaning we likely do not cover your street.<br>Try a nearby street or check the map to see if we visit a nearby area!</div>';
        return;
    }

    // For street search, deduplicate streets on the same day (using clean name without numbers)
    if (searchType === 'street') {
        const seen = new Set();
        results = results.filter(function(item) {
            const cleanStreet = getCleanStreetName(item.street);
            const key = cleanStreet + '|' + item.date;
            if (seen.has(key)) {
                return false;
            }
            seen.add(key);
            return true;
        });
    }

    // Sort results
    if (searchType === 'street') {
        // For street search, sort by date
        results.sort(function(a, b) {
            return new Date(a.date) - new Date(b.date);
        });
    } else {
        // For date search, keep the numerical order from the sheet
        results.sort(function(a, b) {
            // Extract the number from the street name for proper sorting
            const getNumber = function(str) {
                const match = str.match(/^(\d+)/);
                return match ? parseInt(match[1]) : 999999;
            };
            return getNumber(a.street) - getNumber(b.street);
        });
    }

    const html = results.map(function(item) {
        if (searchType === 'street') {
            // REMOVE numbers for street search
            return '<div class="result-item"><div class="result-date">📅 ' + formatDate(item.date) + '</div><div class="result-street">' + escapeHtml(getCleanStreetName(item.street)) + '</div><div class="result-route">🎅 ' + escapeHtml(item.route) + '</div>' + (item.time ? '<div class="result-time">🕐 Approx. ' + escapeHtml(item.time) + '</div>' : '') + '</div>';
        } else {
            // KEEP numbers for date search (to show order)
            return '<div class="result-item"><div class="result-street">' + escapeHtml(item.street) + '</div><div class="result-route">🎅 ' + escapeHtml(item.route) + '</div>' + (item.time ? '<div class="result-time">🕐 Approx. ' + escapeHtml(item.time) + '</div>' : '') + '</div>';
        }
    }).join('');

    resultsArea.innerHTML = html;
}

// Format date
function formatDate(dateString) {
    const date = new Date(dateString + 'T00:00:00');
    const options = { weekday: 'short', month: 'short', day: 'numeric' };
    return date.toLocaleDateString('en-GB', options);
}

// Escape HTML
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Strip numbering from street names for display
function stripStreetNumber(streetName) {
    // Remove leading numbers with dot or dash (e.g., "01. " or "1. " or "01 - ")
    return streetName.replace(/^\d+[\.\-]\s*/, '').trim();
}

// Get clean street name for display (removes number and partial tag)
function getCleanStreetName(streetName) {
    let clean = stripStreetNumber(streetName);
    // Optionally remove "(Partial)" tag for cleaner display
    // clean = clean.replace(/\s*\(Partial\)\s*/gi, '').trim();
    return clean;
}

// Get street name for searching (removes number but keeps partial info)
function getSearchableStreetName(streetName) {
    return stripStreetNumber(streetName);
}

// Modal for all routes
function initializeModal() {
    const allRoutesBtn = document.getElementById('allRoutesBtn');
    const allRoutesBtnMobile = document.getElementById('allRoutesBtnMobile');
    const allRoutesModal = document.getElementById('allRoutesModal');
    const closeModalBtn = document.getElementById('closeModal');
    
    if (!allRoutesModal || !closeModalBtn) return;
    
    // Function to show all routes
    function openAllRoutes(e) {
        e.preventDefault();
        showAllRoutes();
    }
    
    if (allRoutesBtn) {
        allRoutesBtn.addEventListener('click', openAllRoutes);
    }
    
    if (allRoutesBtnMobile) {
        allRoutesBtnMobile.addEventListener('click', openAllRoutes);
    }

    closeModalBtn.addEventListener('click', function() {
        allRoutesModal.classList.remove('show');
    });

    allRoutesModal.addEventListener('click', function(e) {
        if (e.target === allRoutesModal) {
            allRoutesModal.classList.remove('show');
        }
    });
}

function showAllRoutes() {
    const allRoutesModal = document.getElementById('allRoutesModal');
    const modalBody = document.getElementById('allRoutesContent');
    
    if (!allRoutesModal || !modalBody) return;
    
    if (routesData.length === 0) {
        modalBody.innerHTML = '<div class="loading">Loading routes...</div>';
        allRoutesModal.classList.add('show');
        return;
    }

    // Group by route and date
    const grouped = {};
    
    routesData.forEach(function(item) {
        const key = item.route + '|' + item.date;
        if (!grouped[key]) {
            grouped[key] = {
                route: item.route,
                date: item.date,
                streets: []
            };
        }
        grouped[key].streets.push(item.street);
    });

    // Sort by date
    const sortedGroups = Object.values(grouped).sort(function(a, b) {
        return new Date(a.date) - new Date(b.date);
    });

    const html = sortedGroups.map(function(group) {
        // Get all items for this group (with time data)
        const groupItems = routesData.filter(function(item) {
            return item.route === group.route && item.date === group.date;
        });
        
        // Sort by street number
        groupItems.sort(function(a, b) {
            const getNumber = function(str) {
                const match = str.match(/^(\d+)/);
                return match ? parseInt(match[1]) : 999999;
            };
            return getNumber(a.street) - getNumber(b.street);
        });
        
        // Display as list with street and time on same line
        const streetsHtml = groupItems.map(function(item) {
            const timeDisplay = item.time ? '<span style="color: #165b33; margin-left: 0.5rem;">🕐 Approx. ' + escapeHtml(item.time) + '</span>' : '';
            return '<div class="street-list-item">' + escapeHtml(item.street) + timeDisplay + '</div>';
        }).join('');
        
        return '<div class="route-group"><div class="route-title">' + formatDate(group.date) + '</div><div class="route-subtitle">' + escapeHtml(group.route) + '</div><div class="streets-list-view">' + streetsHtml + '</div></div>';
    }).join('');

    modalBody.innerHTML = html;
    allRoutesModal.classList.add('show');
}

// Load sightings
async function loadSightings() {
    const container = document.getElementById('latestSighting');
    
    if (!container) {
        console.log('latestSighting container not found');
        return;
    }
    
    // Check if sightings should be displayed
    const sightingsStatus = checkSightingsAvailability();
    
    if (!sightingsStatus.showData) {
        // Show appropriate message
        container.innerHTML = '<div style="text-align: center; padding: 2rem; color: #666; line-height: 1.6;"><strong style="display: block; font-size: 1.1rem; margin-bottom: 0.5rem;">🎅</strong>' + sightingsStatus.message + '</div>';
        return;
    }
    
    try {
        const response = await fetch('/.netlify/functions/get-sightings');
        const data = await response.json();
        
        if (data.success && data.sightings && data.sightings.length > 0) {
            displaySightings(data.sightings);
        } else {
            container.innerHTML = '<div style="text-align: center; padding: 1rem; color: #666;">🎅 No sightings yet - be the first to spot Santa!</div>';
        }
    } catch (error) {
        console.error('Error loading sightings:', error);
        container.innerHTML = '<div style="text-align: center; padding: 1rem; color: #666;">🎅 No sightings yet - be the first to spot Santa!</div>';
    }
}

// Check if sightings are available based on date/time.
// Driven by siteStatus (from /.netlify/functions/get-site-status), which
// derives the active window from the actual route dates in Netlify DB and
// the `settings` table -- instead of dates/times hardcoded to one
// specific year's calendar.
function checkSightingsAvailability() {
    if (!siteStatus || !siteStatus.sightings) {
        return {
            showData: false,
            message: 'Loading...'
        };
    }

    const sightings = siteStatus.sightings;

    return {
        showData: sightings.active,
        message: sightings.active ? '' : sightingsMessageForState(sightings.state, sightings)
    };
}

// Maps a sightings.state value (computed server-side) to a friendly message.
function sightingsMessageForState(state, sightings) {
    const nextRouteDate = sightings && sightings.nextRouteDate;

    switch (state) {
        case 'off-season':
            return 'Santa visits during December! Check back when the season starts.';
        case 'not-a-route-day':
            return nextRouteDate
                ? 'Check back soon for Santa sightings! Next stop: ' + formatDate(nextRouteDate)
                : 'Check back soon for Santa sightings!';
        case 'before-window':
            return 'Check back this evening! Santa starts his rounds at ' + formatHourLabel(sightings.windowStart) + '. \ud83c\udf85';
        case 'after-window':
            return nextRouteDate
                ? 'Check back ' + formatDate(nextRouteDate) + '! Santa has finished his rounds for tonight. \ud83c\udf19'
                : 'Santa has finished his rounds for tonight. \ud83c\udf19';
        case 'season-ending':
            return 'Santa has returned back to the North Pole ready for the main event Christmas Eve! \ud83c\udf84';
        case 'error':
            return "Unable to check Santa's schedule right now \u2014 please try again shortly.";
        default:
            return 'Check back soon for Santa sightings!';
    }
}

// Formats a "HH:MM" 24-hour string as a friendly "5pm" / "5:30pm" label.
function formatHourLabel(hhmm) {
    if (!hhmm) return '';
    const parts = hhmm.split(':').map(Number);
    const h = parts[0];
    const m = parts[1] || 0;
    const period = h >= 12 ? 'pm' : 'am';
    let hour12 = h % 12;
    if (hour12 === 0) hour12 = 12;
    return m === 0 ? (hour12 + period) : (hour12 + ':' + String(m).padStart(2, '0') + period);
}

// Check if report button should be enabled.
// Uses the same siteStatus.sightings.active flag as checkSightingsAvailability
// above, so reporting a sighting is only possible exactly when sightings are
// being shown.
function checkReportButtonAvailability() {
    return !!(siteStatus && siteStatus.sightings && siteStatus.sightings.active);
}

function displaySightings(sightings) {
    const container = document.getElementById('latestSighting');
    if (!container) return;
    
    const html = sightings.map(function(sighting) {
        const timeAgo = formatSightingTime(sighting.timestamp);
        const cleanStreetName = getCleanStreetName(sighting.street);
        return '<div class="sighting-item"><div class="sighting-icon">🎅</div><div class="sighting-details"><div class="sighting-street">' + escapeHtml(cleanStreetName) + '</div><div class="sighting-user-time">' + escapeHtml(sighting.time) + '</div><div class="sighting-reported">Reported ' + timeAgo + '</div></div></div>';
    }).join('');
    
    container.innerHTML = html;
}

function formatSightingTime(timestamp) {
    if (!timestamp) return 'recently';
    
    // Google Forms timestamp format: "16/10/2025 14:04:53" (DD/MM/YYYY HH:MM:SS)
    // iOS Safari requires specific date format, so we need to be more careful
    try {
        const parts = timestamp.split(' ');
        if (parts.length === 2) {
            const dateParts = parts[0].split('/');
            const timeParts = parts[1].split(':');
            
            if (dateParts.length === 3 && timeParts.length === 3) {
                // Create date using individual components (works on iOS)
                const year = parseInt(dateParts[2]);
                const month = parseInt(dateParts[1]) - 1; // Month is 0-indexed
                const day = parseInt(dateParts[0]);
                const hour = parseInt(timeParts[0]);
                const minute = parseInt(timeParts[1]);
                const second = parseInt(timeParts[2]);
                
                const date = new Date(year, month, day, hour, minute, second);
                
                if (!isNaN(date.getTime())) {
                    const now = new Date();
                    const diffMs = now - date;
                    const diffMins = Math.floor(diffMs / 60000);
                    
                    if (diffMins < 1) return 'just now';
                    if (diffMins < 60) return diffMins + ' min' + (diffMins > 1 ? 's' : '') + ' ago';
                    
                    const diffHours = Math.floor(diffMins / 60);
                    if (diffHours < 24) return diffHours + ' hour' + (diffHours > 1 ? 's' : '') + ' ago';
                    
                    return date.toLocaleDateString('en-GB', { month: 'short', day: 'numeric' });
                }
            }
        }
    } catch (e) {
        console.error('Error parsing timestamp:', timestamp, e);
    }
    
    return 'recently';
}

// Initialize sighting modal
function initializeSightingModal() {
    const sightingModal = document.getElementById('sightingModal');
    const closeSightingModal = document.getElementById('closeSightingModal');
    const sightingForm = document.getElementById('sightingForm');
    const sightingStreetInput = document.getElementById('sightingStreet');
    const streetSuggestions = document.getElementById('streetSuggestions');
    
    // Check all elements exist
    if (!sightingModal || !closeSightingModal || !sightingForm) {
        console.error('Missing sighting modal elements');
        return;
    }
    
    console.log('Setting up sighting modal listeners...');
    
    // Function to open modal
    function openModal(e) {
        if (e) e.preventDefault();
        
        // Check if reporting is currently allowed
        if (!checkReportButtonAvailability()) {
            alert(siteStatus && siteStatus.sightings ? sightingsMessageForState(siteStatus.sightings.state, siteStatus.sightings) : "Santa sighting reports aren't available right now.");
            return;
        }
        
        console.log('Report button clicked');
        sightingModal.classList.add('show');
        // Set default time to now
        const now = new Date();
        const hours = String(now.getHours()).padStart(2, '0');
        const mins = String(now.getMinutes()).padStart(2, '0');
        const timeInput = document.getElementById('sightingTime');
        if (timeInput) {
            timeInput.value = hours + ':' + mins;
        }
    }
    
    // Find all report sighting buttons and add listeners
    const reportButtons = document.querySelectorAll('#reportSightingBtn, #reportSightingBtn2');
    reportButtons.forEach(function(btn) {
        if (btn) {
            btn.addEventListener('click', openModal);
            console.log('Added listener to button:', btn.id);
            
            // Update button appearance based on availability
            updateReportButtonState(btn);
        }
    });
    
    // Update button states every minute
    setInterval(function() {
        reportButtons.forEach(function(btn) {
            if (btn) {
                updateReportButtonState(btn);
            }
        });
    }, 60000); // Check every minute

    // Close modal
    closeSightingModal.addEventListener('click', function() {
        sightingModal.classList.remove('show');
        resetSightingForm();
    });

    sightingModal.addEventListener('click', function(e) {
        if (e.target === sightingModal) {
            sightingModal.classList.remove('show');
            resetSightingForm();
        }
    });

    // Street autocomplete with smart matching
    if (sightingStreetInput && streetSuggestions) {
        sightingStreetInput.addEventListener('input', function(e) {
            const query = e.target.value.toLowerCase().trim();
            
            if (query.length < 2) {
                streetSuggestions.classList.remove('show');
                return;
            }

            // 🆕 Clean the query for autocomplete too
            const cleanQuery = cleanSearchQuery(query);
            const searchQuery = cleanQuery.length >= 2 ? cleanQuery : query;

            // Get matching streets
            const matchingItems = routesData.filter(function(item) {
                return streetMatches(item.street, searchQuery);
            });
            
            // Deduplicate by clean street name (without numbers)
            const seen = new Set();
            const uniqueItems = matchingItems.filter(function(item) {
                const cleanName = getCleanStreetName(item.street);
                if (seen.has(cleanName)) {
                    return false;
                }
                seen.add(cleanName);
                return true;
            });
            
            // Limit to 5 suggestions
            const matches = uniqueItems.slice(0, 5);

            if (matches.length > 0) {
                // REMOVE numbers from autocomplete suggestions
                const html = matches.map(function(item) {
                    const cleanName = getCleanStreetName(item.street);
                    return '<div class="suggestion-item" data-street="' + escapeHtml(item.street) + '">' + escapeHtml(cleanName) + '</div>';
                }).join('');
                
                streetSuggestions.innerHTML = html;
                streetSuggestions.classList.add('show');
            } else {
                streetSuggestions.classList.remove('show');
            }
        });

        // Handle suggestion click
        streetSuggestions.addEventListener('click', function(e) {
            if (e.target.classList.contains('suggestion-item')) {
                const street = e.target.dataset.street;
                // Show clean name in the input field
                sightingStreetInput.value = getCleanStreetName(street);
                // But store the full name for validation
                selectedStreet = street;
                streetSuggestions.classList.remove('show');
            }
        });
    }

    // Time when buttons
    const timeButtons = document.querySelectorAll('.time-btn');
    timeButtons.forEach(function(btn) {
        btn.addEventListener('click', function() {
            timeButtons.forEach(function(b) {
                b.classList.remove('active');
            });
            btn.classList.add('active');
            
            // If "Just Now" is clicked, update the time input to current time
            if (btn.dataset.when === 'now') {
                const now = new Date();
                const hours = String(now.getHours()).padStart(2, '0');
                const mins = String(now.getMinutes()).padStart(2, '0');
                const timeInput = document.getElementById('sightingTime');
                if (timeInput) {
                    timeInput.value = hours + ':' + mins;
                }
            }
        });
    });

    // Form submission
    sightingForm.addEventListener('submit', async function(e) {
        e.preventDefault();
        await submitSighting();
    });
    
    console.log('Sighting modal setup complete');
}

// Update report button state based on availability
function updateReportButtonState(button) {
    const isAvailable = checkReportButtonAvailability();
    
    // Store original text if not already stored
    if (!button.dataset.originalText) {
        button.dataset.originalText = button.textContent;
    }
    
    if (isAvailable) {
        button.style.opacity = '1';
        button.style.cursor = 'pointer';
        button.style.background = 'var(--santa-red)';
        button.disabled = false;
        button.textContent = button.dataset.originalText;
    } else {
        button.style.opacity = '0.5';
        button.style.cursor = 'not-allowed';
        button.style.background = '#999';
        button.disabled = true;
        button.textContent = '🔒 ' + button.dataset.originalText;
    }
}

async function submitSighting() {
    const sightingStreetInput = document.getElementById('sightingStreet');
    const timeInput = document.getElementById('sightingTime');
    const messageDiv = document.getElementById('formMessage');
    const sightingForm = document.getElementById('sightingForm');
    
    if (!sightingStreetInput || !timeInput || !messageDiv || !sightingForm) {
        console.error('Form elements not found');
        return;
    }
    
    const street = sightingStreetInput.value.trim();
    const time = timeInput.value;
    const whenBtn = document.querySelector('.time-btn.active');
    let when = whenBtn ? whenBtn.dataset.when : 'now';

    // Convert to exact form values
    if (when === 'now') {
        when = 'Just Now';
    } else if (when === 'earlier') {
        when = 'Earlier Today';
    }
    const submitBtn = sightingForm.querySelector('.submit-btn');

    // Validate
    if (!street || !time) {
        messageDiv.className = 'form-message error';
        messageDiv.textContent = 'Please fill in all required fields';
        return;
    }

    // 🆕 Clean the street input for matching
    const cleanStreet = cleanSearchQuery(street);
    const searchStreet = cleanStreet.length >= 2 ? cleanStreet : street;

    // Check if street is in the valid list (using smart matching)
    const validStreet = routesData.find(function(r) {
        return streetMatches(r.street, searchStreet);
    });

    if (!validStreet) {
        messageDiv.className = 'form-message error';
        messageDiv.textContent = 'Please select a street from the list';
        return;
    }

    // Disable submit button
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Submitting...';
    }
    messageDiv.className = 'form-message';
    messageDiv.style.display = 'none';

    try {
        const response = await fetch('/.netlify/functions/submit-sighting', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ street: validStreet.street, time: time, when: when })
        });

        const data = await response.json();

        if (data.success) {
            messageDiv.className = 'form-message success';
            messageDiv.textContent = 'Thank you! Your sighting has been recorded.';
            
            // Reset form
            setTimeout(function() {
                const sightingModal = document.getElementById('sightingModal');
                if (sightingModal) {
                    sightingModal.classList.remove('show');
                }
                resetSightingForm();
                loadSightings();
            }, 2000);
        } else {
            throw new Error(data.error || 'Failed to submit');
        }
    } catch (error) {
        console.error('Error submitting sighting:', error);
        messageDiv.className = 'form-message error';
        messageDiv.textContent = 'Failed to submit. Please try again.';
    } finally {
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Submit Sighting';
        }
    }
}

function resetSightingForm() {
    const sightingForm = document.getElementById('sightingForm');
    const streetSuggestions = document.getElementById('streetSuggestions');
    const messageDiv = document.getElementById('formMessage');
    
    if (sightingForm) sightingForm.reset();
    selectedStreet = '';
    if (streetSuggestions) streetSuggestions.classList.remove('show');
    if (messageDiv) {
        messageDiv.className = 'form-message';
        messageDiv.style.display = 'none';
    }
    
    const timeButtons = document.querySelectorAll('.time-btn');
    timeButtons.forEach(function(b) {
        b.classList.remove('active');
    });
    const nowBtn = document.querySelector('.time-btn[data-when="now"]');
    if (nowBtn) nowBtn.classList.add('active');
}

// Keyboard accessibility
document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
        const allRoutesModal = document.getElementById('allRoutesModal');
        const sightingModal = document.getElementById('sightingModal');
        
        if (allRoutesModal && allRoutesModal.classList.contains('show')) {
            allRoutesModal.classList.remove('show');
        }
        if (sightingModal && sightingModal.classList.contains('show')) {
            sightingModal.classList.remove('show');
        }
    }
});