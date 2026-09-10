// Netlify Function to get latest Santa sightings
const https = require('https');

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
    const SIGHTINGS_SHEET_URL = process.env.SIGHTINGS_SHEET_URL;

    console.log('Getting sightings from sheet:', SIGHTINGS_SHEET_URL ? 'SET' : 'NOT SET');

    if (!SIGHTINGS_SHEET_URL) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          sightings: [],
          message: 'No sightings yet - be the first to spot Santa!'
        })
      };
    }

    // Fetch sightings from Google Sheet
    const csvData = await fetchSheet(SIGHTINGS_SHEET_URL);
    console.log('CSV data fetched, length:', csvData.length);
    
    const sightings = parseCSV(csvData);
    console.log('Parsed sightings:', sightings.length);

    // Filter to only sightings from the last 6 hours (extended to account for timezone differences)
    const sixHoursAgo = new Date(Date.now() - (6 * 60 * 60 * 1000));
    
    console.log('Current server time:', new Date().toISOString());
    console.log('Filtering sightings after:', sixHoursAgo.toISOString());
    
    const recentSightings = sightings.filter(sighting => {
      // Parse Google Forms timestamp: "16/10/2025 14:04:53"
      const parts = sighting.timestamp.split(' ');
      if (parts.length === 2) {
        const dateParts = parts[0].split('/');
        if (dateParts.length === 3) {
          // Assuming Google Forms records in UK time (GMT/BST)
          const isoDate = dateParts[2] + '-' + dateParts[1] + '-' + dateParts[0] + 'T' + parts[1];
          const sightingDate = new Date(isoDate);
          console.log('Sighting timestamp:', sighting.timestamp, '-> Parsed:', sightingDate.toISOString(), 'Recent?', sightingDate > sixHoursAgo);
          return sightingDate > sixHoursAgo;
        }
      }
      return false;
    });

    // Get latest 5 sightings, sorted by timestamp (most recent first)
    const latestSightings = recentSightings
      .sort((a, b) => {
        const dateA = parseGoogleFormsDate(a.timestamp);
        const dateB = parseGoogleFormsDate(b.timestamp);
        return dateB - dateA; // Most recent first
      })
      .slice(0, 5);

    console.log('Total sightings:', sightings.length, 'Recent (last 5h):', recentSightings.length, 'Returning:', latestSightings.length);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        sightings: latestSightings,
        total: sightings.length
      })
    };

  } catch (error) {
    console.error('Error fetching sightings:', error);
    
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        sightings: [],
        error: error.message
      })
    };
  }
};

function fetchSheet(url) {
  return new Promise((resolve, reject) => {
    const fetchUrl = (currentUrl, redirectCount = 0) => {
      if (redirectCount > 5) {
        return reject(new Error('Too many redirects'));
      }

      https.get(currentUrl, (res) => {
        // Handle redirects
        if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307 || res.statusCode === 308) {
          const redirectUrl = res.headers.location;
          console.log('Following redirect to:', redirectUrl);
          return fetchUrl(redirectUrl, redirectCount + 1);
        }

        if (res.statusCode === 200) {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => resolve(data));
          return;
        }

        reject(new Error(`HTTP ${res.statusCode}`));
      }).on('error', reject);
    };

    fetchUrl(url);
  });
}

function parseCSV(csvText) {
  const lines = csvText.trim().split('\n');
  
  if (lines.length < 2) {
    console.log('Not enough lines in CSV');
    return [];
  }

  // Get headers from first row
  const rawHeaders = parseCSVLine(lines[0]);
  console.log('CSV Headers:', rawHeaders);
  
  // Map Google Forms column names to our expected names
  const headerMap = {};
  rawHeaders.forEach((header, index) => {
    const cleanHeader = header.trim().toLowerCase();
    if (cleanHeader === 'timestamp') {
      headerMap[index] = 'timestamp';
    } else if (cleanHeader === 'street name') {
      headerMap[index] = 'street';
    } else if (cleanHeader === 'time seen') {
      headerMap[index] = 'time';
    } else if (cleanHeader === 'when') {
      headerMap[index] = 'when';
    }
  });

  console.log('Header mapping:', headerMap);

  const sightings = [];

  // Parse data rows (skip header)
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const values = parseCSVLine(line);
    
    const sighting = {};
    values.forEach((value, index) => {
      if (headerMap[index]) {
        sighting[headerMap[index]] = value.trim();
      }
    });

    // Only add if it has required fields
    if (sighting.street && sighting.time) {
      sightings.push(sighting);
      console.log('Added sighting:', sighting);
    }
  }

  return sightings;
}

function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  
  result.push(current);
  return result.map(v => v.replace(/^["']|["']$/g, ''));
}

function parseGoogleFormsDate(timestamp) {
  // Parse "16/10/2025 14:04:53" format
  const parts = timestamp.split(' ');
  if (parts.length === 2) {
    const dateParts = parts[0].split('/');
    if (dateParts.length === 3) {
      const isoDate = dateParts[2] + '-' + dateParts[1] + '-' + dateParts[0] + 'T' + parts[1];
      return new Date(isoDate);
    }
  }
  return new Date(0);
}