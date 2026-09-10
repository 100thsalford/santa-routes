// Netlify Function to fetch routes from Google Sheets
const https = require('https');

exports.handler = async (event, context) => {
  // Set CORS headers
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  // Handle preflight requests
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers,
      body: ''
    };
  }

  try {
    // Your Google Sheet should be published to the web as CSV
    // Go to: File > Share > Publish to web > Choose your sheet > CSV
    // Replace this URL with your actual published Google Sheet CSV URL
    const GOOGLE_SHEET_URL = process.env.GOOGLE_SHEET_URL;

    // Log for debugging (visible in Netlify function logs)
    console.log('Environment variable exists:', !!GOOGLE_SHEET_URL);
    
    if (!GOOGLE_SHEET_URL) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: false,
          error: 'GOOGLE_SHEET_URL environment variable not set',
          routes: [],
          debug: {
            message: 'Please set GOOGLE_SHEET_URL in Netlify environment variables',
            envVarExists: false
          }
        })
      };
    }

    console.log('Fetching from URL:', GOOGLE_SHEET_URL.substring(0, 50) + '...');

    // Fetch data from Google Sheets
    const csvData = await fetchGoogleSheet(GOOGLE_SHEET_URL);
    
    console.log('CSV data length:', csvData.length);
    console.log('First 100 chars:', csvData.substring(0, 100));
    
    // Parse CSV to JSON
    const routes = parseCSV(csvData);
    
    console.log('Parsed routes count:', routes.length);
    if (routes.length > 0) {
      console.log('Sample route:', JSON.stringify(routes[0]));
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        routes: routes,
        lastUpdated: new Date().toISOString(),
        debug: {
          totalRoutes: routes.length,
          sampleRoute: routes[0] || null
        }
      })
    };

  } catch (error) {
    console.error('Error fetching routes:', error);
    
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: false,
        error: error.message,
        routes: [],
        debug: {
          errorType: error.name,
          errorMessage: error.message
        }
      })
    };
  }
};

// Fetch Google Sheet data with redirect handling
function fetchGoogleSheet(url) {
  return new Promise((resolve, reject) => {
    const followRedirects = (currentUrl, depth = 0) => {
      if (depth > 5) {
        return reject(new Error('Too many redirects'));
      }

      const options = {
        headers: {
          'User-Agent': 'Mozilla/5.0'
        }
      };

      console.log(`Fetching (depth ${depth}):`, currentUrl);

      https.get(currentUrl, options, (res) => {
        console.log(`Response status: ${res.statusCode}`);
        
        // Handle redirects (301, 302, 307, 308)
        if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307 || res.statusCode === 308) {
          const redirectUrl = res.headers.location;
          console.log('Redirecting to:', redirectUrl);
          return followRedirects(redirectUrl, depth + 1);
        }

        // Handle success
        if (res.statusCode === 200) {
          let data = '';
          res.on('data', (chunk) => {
            data += chunk;
          });
          res.on('end', () => {
            console.log('Data received, length:', data.length);
            resolve(data);
          });
          return;
        }

        // Handle errors
        reject(new Error(`Failed to fetch: HTTP ${res.statusCode}`));
      }).on('error', (err) => {
        console.error('Request error:', err);
        reject(err);
      });
    };

    followRedirects(url);
  });
}

// Parse CSV data to JSON
function parseCSV(csvText) {
  const lines = csvText.trim().split('\n');
  
  if (lines.length < 2) {
    console.log('Not enough lines in CSV');
    return [];
  }

  // Get headers (first row) - normalize to lowercase and trim
  const rawHeaders = lines[0].split(',').map(h => h.trim().replace(/['"]/g, '').toLowerCase());
  console.log('Headers found:', rawHeaders.join(', '));
  
  // Check for required columns
  const hasStreet = rawHeaders.includes('street');
  const hasDate = rawHeaders.includes('date');
  const hasRoute = rawHeaders.includes('route');
  
  if (!hasStreet || !hasDate || !hasRoute) {
    console.error('Missing required columns. Found:', rawHeaders);
    console.error('Required: street, date, route');
  }
  
  // Parse data rows
  const routes = [];
  
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue; // Skip empty lines
    
    const values = parseCSVLine(line);
    
    if (values.length >= rawHeaders.length) {
      const route = {};
      rawHeaders.forEach((header, index) => {
        route[header] = values[index] ? values[index].trim() : '';
      });
      
      // Only add if it has required fields
      if (route.street && route.date && route.route) {
        routes.push(route);
      } else {
        console.log('Skipping incomplete row:', route);
      }
    }
  }

  return routes;
}

// Parse a single CSV line (handles quoted values with commas)
function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const nextChar = line[i + 1];
    
    if (char === '"' && nextChar === '"') {
      // Handle escaped quotes
      current += '"';
      i++; // Skip next quote
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  
  result.push(current);
  return result.map(v => v.replace(/^["']|["']$/g, '').trim());
}

/* 
SETUP INSTRUCTIONS:

1. In your Google Sheet, make sure you have these columns (EXACT names, lowercase):
   - street (Street name)
   - date (Format: YYYY-MM-DD, e.g., 2024-12-15)
   - route (e.g., "Route 1", "Route 2")
   - time (Optional: e.g., "6:00 PM - 8:00 PM")

2. Publish your Google Sheet to the web:
   - Open your Google Sheet
   - Go to File > Share > Publish to web
   - Choose the specific sheet/tab you want to publish
   - Select "Comma-separated values (.csv)" format
   - Click "Publish"
   - Copy the URL (it should look like: https://docs.google.com/spreadsheets/d/LONG_ID/export?format=csv&gid=0)

3. Add the URL to Netlify:
   - Go to your Netlify site dashboard
   - Go to Site settings > Environment variables
   - Click "Add a variable"
   - Add new variable:
     Key: GOOGLE_SHEET_URL
     Value: [paste your published CSV URL]
   - Click "Save"

4. Redeploy your site:
   - Go to Deploys tab
   - Click "Trigger deploy" > "Deploy site"
   - Wait for deployment to complete

5. Test:
   - Go to https://YOUR-SITE.netlify.app/debug.html
   - Click "Test Function" to see if it works
   - Check the debug output

Example Google Sheet structure:
street,date,route,time
Abbey Road,2024-12-15,Route 1,6:00 PM - 7:00 PM
Acacia Avenue,2024-12-15,Route 1,7:00 PM - 8:00 PM
Baker Street,2024-12-16,Route 2,6:00 PM - 7:00 PM
*/