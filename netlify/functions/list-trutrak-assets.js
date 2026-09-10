// Netlify diagnostic function to list all available TruTrak assets
// Location: /netlify/functions/list-trutrak-assets.js
// Use this ONCE to find your correct Asset ID, then delete this file

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
    
    const response = await httpsRequest(
        'https://ttapi.trutrakpro.co.uk/WSDataProvider.asmx/TTAuthenticate',
        options,
        postData
    );
    
    const result = await parseStringPromise(response.data);
    return result.Root.Authenticated[0].Token[0];
}

// Get list of all assets
async function getAssetsList(token) {
    const postData = new URLSearchParams({
        Token: token,
        Filter_registration: '', // Empty = get all
        Filter_Depots: '',       // Empty = get all
        XMLType: '0'
    }).toString();
    
    const options = {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Content-Length': postData.length
        }
    };
    
    const response = await httpsRequest(
        'https://ttapi.trutrakpro.co.uk/WSDataProvider.asmx/TTAssetsList',
        options,
        postData
    );
    
    console.log('Assets list raw response (first 1000 chars):', response.data.substring(0, 1000));
    
    const result = await parseStringPromise(response.data);
    console.log('Parsed XML structure:', JSON.stringify(result, null, 2));
    
    if (result.Root && result.Root.Error) {
        throw new Error(`TruTrak Error: ${result.Root.Error[0].Error_Message[0]}`);
    }
    
    if (!result.Root || !result.Root.Row) {
        console.log('No Row found in result');
        return [];
    }
    
    // Convert to simple array of assets
    const assets = result.Root.Row.map((row, index) => {
        console.log(`Processing row ${index}:`, JSON.stringify(row));
        
        return {
            id: row.ID ? row.ID[0] : 'unknown',
            registration: row.Reg ? row.Reg[0] : 'unknown',
            depotId: row.Depot_ID ? row.Depot_ID[0] : 'unknown'
        };
    });
    
    console.log('Processed assets:', JSON.stringify(assets));
    return assets;
}

// Netlify function handler
exports.handler = async (event, context) => {
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Content-Type': 'application/json'
    };
    
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: '' };
    }
    
    try {
        // Get credentials from environment variables
        const TRUTRAK_LOGIN = process.env.TRUTRAK_LOGIN;
        const TRUTRAK_PASSWORD = process.env.TRUTRAK_PASSWORD;
        const TRUTRAK_SKEY = process.env.TRUTRAK_SKEY;
        
        if (!TRUTRAK_LOGIN || !TRUTRAK_PASSWORD || !TRUTRAK_SKEY) {
            throw new Error('Missing TruTrak credentials in environment variables');
        }
        
        console.log('Authenticating...');
        const token = await authenticateTruTrak(TRUTRAK_LOGIN, TRUTRAK_PASSWORD, TRUTRAK_SKEY);
        console.log('Authentication successful');
        
        console.log('Fetching assets list...');
        const assets = await getAssetsList(token);
        console.log(`Found ${assets.length} assets`);
        
        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                success: true,
                totalAssets: assets.length,
                assets: assets,
                instructions: {
                    step1: "Find your vehicle in the 'assets' array above",
                    step2: "Copy the 'id' value (NOT the registration number)",
                    step3: "Set TRUTRAK_VEHICLE_ID environment variable to this id",
                    step4: "Example: If id is '10123', set TRUTRAK_VEHICLE_ID=10123",
                    step5: "After setting the ID, you can delete this diagnostic function"
                }
            }, null, 2)
        };
        
    } catch (error) {
        console.error('Error:', error);
        console.error('Error stack:', error.stack);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({
                success: false,
                error: error.message,
                stack: error.stack,
                help: 'Check the Netlify function logs for detailed output: Dashboard → Functions → list-trutrak-assets → View logs'
            }, null, 2)
        };
    }
};
