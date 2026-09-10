// Netlify serverless function to fetch TruTrak GPS data
// Location: /netlify/functions/get-tracker-data.js

const https = require('https');
const { parseStringPromise } = require('xml2js');

// Helper function to make HTTPS requests with redirect support
function httpsRequest(url, options, postData = null, redirectCount = 0) {
    return new Promise((resolve, reject) => {
        if (redirectCount > 5) {
            return reject(new Error('Too many redirects'));
        }
        
        const req = https.request(url, options, (res) => {
            // Follow redirects (301, 302, 307, 308)
            if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location) {
                console.log(`Following redirect to: ${res.headers.location}`);
                return resolve(httpsRequest(res.headers.location, options, postData, redirectCount + 1));
            }
            
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => resolve({ statusCode: res.statusCode, data }));
        });
        req.on('error', reject);
        if (postData) req.write(postData);
        req.end();
    });
}

// Helper function to parse CSV data
function parseCSV(csvText) {
    const lines = csvText.trim().split('\n');
    const rows = lines.map(line => {
        // Handle potential line breaks and trim
        const cleanLine = line.replace(/\r/g, '').trim();
        if (!cleanLine) return [];
        
        // Simple CSV parser (handles basic cases)
        return cleanLine.split(',').map(cell => cell.trim());
    }).filter(row => row.length > 0); // Remove empty rows
    
    return rows;
}

// Helper function to fetch published Google Sheets as CSV
async function fetchSheetData(sheetId) {
    // Use the published CSV endpoint - no API key needed!
    const url = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=0`;
    
    const response = await httpsRequest(url, { method: 'GET' });
    
    // Log raw response for debugging
    console.log('Raw CSV response (first 500 chars):', response.data.substring(0, 500));
    console.log('Response length:', response.data.length);
    console.log('Status code:', response.statusCode);
    
    // Check if we got HTML instead of CSV (shouldn't happen with redirect fix, but just in case)
    if (response.data.includes('<HTML>') || response.data.includes('<html>')) {
        throw new Error('Received HTML instead of CSV. Sheet may not be published correctly.');
    }
    
    const parsed = parseCSV(response.data);
    console.log('Parsed rows:', parsed.length);
    console.log('First 3 rows:', JSON.stringify(parsed.slice(0, 3)));
    
    return parsed;
}

// Check if tracker should be enabled based on Google Sheets schedule
async function isTrackerEnabled(sheetId) {
    try {
        const rows = await fetchSheetData(sheetId);
        
        if (!rows || rows.length < 2) {
            return { 
                enabled: false, 
                routeVisible: false,
                reason: 'No schedule data', 
                rows: rows 
            };
        }
        
        // Get current time in UK/London timezone
        const now = new Date();
        const ukTime = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/London' }));
        const today = ukTime.toISOString().split('T')[0]; // YYYY-MM-DD
        const currentTime = ukTime.toTimeString().split(' ')[0].substring(0, 5); // HH:MM
        
        const matchedRows = [];
        const allRows = [];
        let todaySchedule = null;
        let isWithinTrackingHours = false;
        
        for (let i = 1; i < rows.length; i++) {
            const row = rows[i];
            
            allRows.push({
                rowIndex: i,
                rawRow: row,
                length: row.length
            });
            
            if (row.length < 3) {
                allRows[allRows.length - 1].skipReason = 'Less than 3 columns';
                continue;
            }
            
            if (!row[0] || row[0].trim() === '') {
                allRows[allRows.length - 1].skipReason = 'Empty first column';
                continue;
            }
            
            const date = row[0].trim();
            const startTime = row[1] ? row[1].trim() : '';
            const endTime = row[2] ? row[2].trim() : '';
            const kmlFile = row[3] ? row[3].trim() : '';
            
            matchedRows.push({ 
                date, 
                startTime, 
                endTime,
                kmlFile,
                matchesDate: date === today,
                hasStartTime: !!startTime,
                hasEndTime: !!endTime
            });
            
            // Check if this is today's schedule
            if (date === today) {
                todaySchedule = { date, startTime, endTime, kmlFile };
                
                // Check if we're within tracking hours
                if (startTime && endTime) {
                    const currentMinutes = parseInt(currentTime.split(':')[0]) * 60 + parseInt(currentTime.split(':')[1]);
                    const startMinutes = parseInt(startTime.split(':')[0]) * 60 + parseInt(startTime.split(':')[1]);
                    const endMinutes = parseInt(endTime.split(':')[0]) * 60 + parseInt(endTime.split(':')[1]);
                    
                    matchedRows[matchedRows.length - 1].currentMinutes = currentMinutes;
                    matchedRows[matchedRows.length - 1].startMinutes = startMinutes;
                    matchedRows[matchedRows.length - 1].endMinutes = endMinutes;
                    matchedRows[matchedRows.length - 1].inRange = currentMinutes >= startMinutes && currentMinutes <= endMinutes;
                    
                    if (currentMinutes >= startMinutes && currentMinutes <= endMinutes) {
                        isWithinTrackingHours = true;
                    }
                }
            }
        }
        
        // If we have today's schedule, show route all day
        if (todaySchedule) {
            return { 
                enabled: isWithinTrackingHours, // Tracking only active during hours
                routeVisible: true, // Route visible all day
                schedule: todaySchedule,
                currentTime: currentTime,
                currentDate: today,
                kmlFile: todaySchedule.kmlFile
            };
        }
        
        return { 
            enabled: false,
            routeVisible: false,
            reason: 'No schedule for today',
            currentTime: currentTime,
            currentDate: today,
            checkedRows: rows.length - 1,
            scheduleRows: matchedRows,
            allRowsDebug: allRows,
            headerRow: rows[0]
        };
    } catch (error) {
        console.error('Error checking schedule:', error);
        return { 
            enabled: false, 
            routeVisible: false,
            reason: 'Schedule check failed', 
            error: error.message 
        };
    }
}

// Authenticate with TruTrak API
async function authenticateTruTrak(login, password, skey) {
    const postData = new URLSearchParams({
        Login: login,
        Password: password,
        SKey: skey
    }).toString();
    
    const options = {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Content-Length': postData.length
        }
    };
    
    console.log('Authenticating with TruTrak...');
    
    const response = await httpsRequest(
        'https://ttapi.trutrakpro.co.uk/WSDataProvider.asmx/TTAuthenticate',
        options,
        postData
    );
    
    console.log('Auth response status:', response.statusCode);
    console.log('Auth response (first 500 chars):', response.data.substring(0, 500));
    
    const result = await parseStringPromise(response.data);
    
    if (!result.Root || !result.Root.Authenticated || !result.Root.Authenticated[0].Token) {
        console.error('Auth failed. Full response:', JSON.stringify(result));
        throw new Error('Failed to authenticate with TruTrak');
    }
    
    const token = result.Root.Authenticated[0].Token[0];
    console.log('Authentication successful. Token:', token.substring(0, 10) + '...');
    
    return token;
}

// Get vehicle location data using TTAssetsLastLocation (real-time position)
async function getVehicleLocation(token, vehicleId) {
    // Try with empty filter first (gets all assets)
    const postData = new URLSearchParams({
        Token: token,
        Filter_assets: '', // Empty = get all assets
        XMLType: '0'
    }).toString();
    
    const options = {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Content-Length': postData.length
        }
    };
    
    console.log('Requesting location with empty filter (all assets)...');
    
    const response = await httpsRequest(
        'https://ttapi.trutrakpro.co.uk/WSDataProvider.asmx/TTAssetsLastLocation',
        options,
        postData
    );
    
    console.log('TruTrak raw response:', response.data);
    console.log('Response status:', response.statusCode);
    
    const result = await parseStringPromise(response.data);
    console.log('Parsed XML:', JSON.stringify(result, null, 2));
    
    // Check for error response from TruTrak
    if (result.Root && result.Root.Error) {
        const errorMsg = result.Root.Error[0].Error_Message[0];
        throw new Error(`TruTrak API Error: ${errorMsg}`);
    }
    
    if (!result.Root || !result.Root.Row) {
        console.error('No Row found in result. Full result:', JSON.stringify(result));
        throw new Error('No location data returned from TruTrak API - device may not have sent GPS data yet');
    }
    
    // If we get multiple rows, filter to our vehicle ID
    let rows = Array.isArray(result.Root.Row) ? result.Root.Row : [result.Root.Row];
    console.log(`Found ${rows.length} asset(s) with location data`);
    
    // Find our specific vehicle
    let row = rows[0]; // Default to first one
    if (vehicleId && rows.length > 1) {
        const matchedRow = rows.find(r => r.Asset_ID && r.Asset_ID[0] === vehicleId);
        if (matchedRow) {
            row = matchedRow;
            console.log(`Matched vehicle ID ${vehicleId}`);
        } else {
            console.log(`Vehicle ID ${vehicleId} not found in results, using first asset`);
        }
    }
    
    console.log('Using row:', JSON.stringify(row, null, 2));
    
    // Helper function to safely get field value
    const getField = (field, defaultValue = '') => {
        return row[field] && row[field][0] ? row[field][0] : defaultValue;
    };
    
    return {
        latitude: parseFloat(getField('latitude', '0')),
        longitude: parseFloat(getField('longitude', '0')),
        speed: parseFloat(getField('speed', '0')),
        timestamp: getField('datetimeLocal', new Date().toISOString()),
        status: getField('Status', 'Unknown'),
        postcode: getField('postcode', 'Unknown'),
        vehicle: getField('Asset_Identification', 'Santa Sleigh'),
        street: getField('street'),
        town: getField('town'),
        heading: getField('heading', '0'),
        driver: getField('Driver'),
        assetId: getField('Asset_ID')
    };
}

// Netlify function handler
exports.handler = async (event, context) => {
    // Enable CORS
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Content-Type': 'application/json'
    };
    
    // Handle preflight
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: '' };
    }
    
    try {
        // Get credentials from environment variables
        const TRUTRAK_LOGIN = process.env.TRUTRAK_LOGIN;
        const TRUTRAK_PASSWORD = process.env.TRUTRAK_PASSWORD;
        const TRUTRAK_SKEY = process.env.TRUTRAK_SKEY;
        const TRUTRAK_VEHICLE_ID = process.env.TRUTRAK_VEHICLE_ID;
        const GOOGLE_SHEETS_ID = process.env.GOOGLE_SHEETS_ID;
        
        if (!TRUTRAK_LOGIN || !TRUTRAK_PASSWORD || !TRUTRAK_SKEY || !TRUTRAK_VEHICLE_ID) {
            throw new Error('Missing TruTrak credentials in environment variables');
        }
        
        // Check if tracker should be enabled (if Google Sheets configured)
        let trackerStatus = { enabled: true, routeVisible: false, reason: 'No schedule configured' };
        if (GOOGLE_SHEETS_ID) {
            trackerStatus = await isTrackerEnabled(GOOGLE_SHEETS_ID);
            
            // If route is visible but tracking not enabled, still fetch location but mark it
            if (trackerStatus.routeVisible && !trackerStatus.enabled) {
                // Try to get location data anyway (might be outside hours but route should show)
                try {
                    const token = await authenticateTruTrak(TRUTRAK_LOGIN, TRUTRAK_PASSWORD, TRUTRAK_SKEY);
                    const locationData = await getVehicleLocation(token, TRUTRAK_VEHICLE_ID);
                    
                    return {
                        statusCode: 200,
                        headers,
                        body: JSON.stringify({
                            enabled: false, // Tracking not active
                            routeVisible: true, // But route should show
                            reason: 'Outside tracking hours - route visible all day',
                            timestamp: new Date().toISOString(),
                            vehicle: {
                                name: 'Santa Sleigh',
                                ...locationData
                            },
                            schedule: trackerStatus.schedule || null,
                            kmlFile: trackerStatus.kmlFile || null
                        })
                    };
                } catch (error) {
                    // If we can't get location, just return route visible
                    return {
                        statusCode: 200,
                        headers,
                        body: JSON.stringify({
                            enabled: false,
                            routeVisible: true,
                            reason: 'Outside tracking hours - route visible all day',
                            message: 'Santa Sleigh tracking inactive, but route is visible',
                            schedule: trackerStatus.schedule || null,
                            kmlFile: trackerStatus.kmlFile || null
                        })
                    };
                }
            }
            
            // No schedule for today at all
            if (!trackerStatus.enabled && !trackerStatus.routeVisible) {
                return {
                    statusCode: 200,
                    headers,
                    body: JSON.stringify({
                        enabled: false,
                        routeVisible: false,
                        reason: trackerStatus.reason,
                        message: 'Santa Sleigh is not scheduled for today',
                        debug: {
                            currentDate: trackerStatus.currentDate,
                            currentTime: trackerStatus.currentTime,
                            checkedRows: trackerStatus.checkedRows,
                            scheduleRows: trackerStatus.scheduleRows,
                            allRowsDebug: trackerStatus.allRowsDebug,
                            headerRow: trackerStatus.headerRow
                        }
                    })
                };
            }
        }
        
        // Authenticate with TruTrak
        const token = await authenticateTruTrak(TRUTRAK_LOGIN, TRUTRAK_PASSWORD, TRUTRAK_SKEY);
        
        // Get location data
        const locationData = await getVehicleLocation(token, TRUTRAK_VEHICLE_ID);
        
        // Return formatted response
        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                enabled: true,
                routeVisible: trackerStatus.routeVisible !== false,
                timestamp: new Date().toISOString(),
                vehicle: {
                    name: 'Santa Sleigh',
                    ...locationData
                },
                schedule: trackerStatus.schedule || null,
                kmlFile: trackerStatus.kmlFile || null
            })
        };
        
    } catch (error) {
        console.error('Error:', error);
        console.error('Error stack:', error.stack);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({
                error: 'Failed to fetch tracker data',
                message: error.message,
                stack: error.stack,
                timestamp: new Date().toISOString()
            })
        };
    }
};
