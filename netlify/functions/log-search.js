// FILE: netlify/functions/log-search.js
// DEBUG VERSION: Temporarily use this to see what's happening

exports.handler = async (event, context) => {
    // Only allow POST requests
    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            body: JSON.stringify({ error: 'Method not allowed' })
        };
    }

    try {
        const data = JSON.parse(event.body);
        const timestamp = new Date().toISOString();
        
        // Get user info
        const userAgent = event.headers['user-agent'] || 'Unknown';
        const referer = event.headers['referer'] || 'Direct';
        const ip = event.headers['x-forwarded-for'] || event.headers['client-ip'] || 'Unknown';
        const cleanIp = ip.split(',')[0].trim();
        
        // Get approximate location from IP using Netlify's geo data
        const country = event.headers['x-country'] || 'Unknown';
        const city = event.headers['x-city'] || 'Unknown';
        const region = event.headers['x-subdivision-code'] || 'Unknown';
        
        // Build the log entry
        const logEntry = {
            timestamp,
            searchTerm: data.searchTerm,
            matchFound: data.matchFound,
            matchedStreet: data.matchedStreet || null,
            resultsCount: data.resultsCount || 0,
            userInfo: {
                ip: cleanIp,
                country,
                city,
                region,
                userAgent,
                referer
            },
            page: data.page || 'Unknown'
        };

        // Log to Netlify console (24-hour retention)
        console.log('SEARCH EVENT:', JSON.stringify(logEntry, null, 2));

        // 🆕 SEND TO GOOGLE SHEETS for permanent storage
        const GOOGLE_SHEETS_URL = process.env.GOOGLE_SHEETS_WEBHOOK_URL;
        
        // 🔍 DEBUG: Log environment variable status
        console.log('🔍 DEBUG: Checking environment variables...');
        console.log('GOOGLE_SHEETS_WEBHOOK_URL exists?', !!GOOGLE_SHEETS_URL);
        if (GOOGLE_SHEETS_URL) {
            console.log('GOOGLE_SHEETS_WEBHOOK_URL starts with:', GOOGLE_SHEETS_URL.substring(0, 50) + '...');
        }
        
        if (GOOGLE_SHEETS_URL) {
            try {
                console.log('📤 Attempting to send to Google Sheets...');
                console.log('📦 Payload:', JSON.stringify(logEntry, null, 2));
                
                const sheetsResponse = await fetch(GOOGLE_SHEETS_URL, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(logEntry)
                });
                
                const responseText = await sheetsResponse.text();
                console.log('📥 Google Sheets response status:', sheetsResponse.status);
                console.log('📥 Google Sheets response body:', responseText);
                
                if (sheetsResponse.ok) {
                    console.log('✅ Successfully sent to Google Sheets');
                } else {
                    console.warn('⚠️ Google Sheets response not OK:', sheetsResponse.status);
                    console.warn('Response body:', responseText);
                }
            } catch (sheetsError) {
                console.error('❌ Failed to send to Google Sheets:', sheetsError.message);
                console.error('Full error:', sheetsError);
            }
        } else {
            console.log('⚠️ GOOGLE_SHEETS_WEBHOOK_URL not configured - skipping Google Sheets logging');
        }

        return {
            statusCode: 200,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
            },
            body: JSON.stringify({ success: true, logged: true })
        };
    } catch (error) {
        console.error('Search logging error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Failed to log search event' })
        };
    }
};