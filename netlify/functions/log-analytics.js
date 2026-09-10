// FILE: netlify/functions/log-analytics.js
// UPDATED: Now sends data to both Netlify logs AND Google Sheets for permanent storage

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
        
        // Build the log entry
        const logEntry = {
            timestamp,
            eventType: data.eventType,
            eventData: data.eventData,
            page: data.page,
            userAgent,
            referer,
            ip: ip.split(',')[0] // First IP in case of multiple
        };

        // Log to Netlify console (24-hour retention)
        console.log('ANALYTICS EVENT:', JSON.stringify(logEntry, null, 2));

        // 🆕 SEND TO GOOGLE SHEETS for permanent storage
        // The webhook URL is stored as an environment variable in Netlify
        const GOOGLE_SHEETS_ANALYTICS_URL = process.env.GOOGLE_SHEETS_ANALYTICS_WEBHOOK_URL;
        
        if (GOOGLE_SHEETS_ANALYTICS_URL) {
            try {
                const sheetsResponse = await fetch(GOOGLE_SHEETS_ANALYTICS_URL, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(logEntry)
                });
                
                if (sheetsResponse.ok) {
                    console.log('✅ Successfully sent to Google Sheets');
                } else {
                    console.warn('⚠️ Google Sheets response not OK:', sheetsResponse.status);
                }
            } catch (sheetsError) {
                console.error('❌ Failed to send to Google Sheets:', sheetsError.message);
                // Don't fail the whole request if Google Sheets fails
                // The data is still logged to Netlify console
            }
        } else {
            console.log('ℹ️ GOOGLE_SHEETS_ANALYTICS_WEBHOOK_URL not configured - skipping Google Sheets logging');
        }

        return {
            statusCode: 200,
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ success: true })
        };
    } catch (error) {
        console.error('Analytics error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Failed to log event' })
        };
    }
};