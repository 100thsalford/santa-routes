// Netlify Function to handle Santa sighting submissions
const https = require('https');

exports.handler = async (event, context) => {
    console.log('SIGHTINGS_FORM_URL:', process.env.SIGHTINGS_FORM_URL ? 'SET' : 'NOT SET');
    console.log('SIGHTINGS_STREET_FIELD:', process.env.SIGHTINGS_STREET_FIELD);
    console.log('Request body:', event.body);
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ success: false, error: 'Method not allowed' })
    };
  }

  try {
    const data = JSON.parse(event.body);
    const { street, time, when } = data;

    // Validate required fields
    if (!street || !time) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ 
          success: false, 
          error: 'Street and time are required' 
        })
      };
    }

    // Google Forms submission URL
    // Format: https://docs.google.com/forms/d/e/FORM_ID/formResponse
    const GOOGLE_FORM_URL = process.env.SIGHTINGS_FORM_URL;
    
    // Field IDs from your Google Form (get these from form inspection)
    const STREET_FIELD = process.env.SIGHTINGS_STREET_FIELD || 'entry.123456789';
    const TIME_FIELD = process.env.SIGHTINGS_TIME_FIELD || 'entry.987654321';
    const WHEN_FIELD = process.env.SIGHTINGS_WHEN_FIELD || 'entry.111111111';

    if (!GOOGLE_FORM_URL) {
      // If form not configured, just log it (for testing)
      console.log('Sighting submitted:', { street, time, when, timestamp: new Date().toISOString() });
      
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          message: 'Sighting recorded! (Demo mode - configure Google Form for production)'
        })
      };
    }

    // Submit to Google Form
    const formData = new URLSearchParams();
    formData.append(STREET_FIELD, street);
    formData.append(TIME_FIELD, time);
    formData.append(WHEN_FIELD, when);
    
    console.log('Submitting to form:', GOOGLE_FORM_URL);
    console.log('Form data:', formData.toString());
    
    await submitToGoogleForm(GOOGLE_FORM_URL, formData);
    
    console.log('Form submission completed successfully');

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        message: 'Thank you! Santa sighting recorded.'
      })
    };

  } catch (error) {
    console.error('Error submitting sighting:', error);
    console.error('Error stack:', error.stack);
    
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        error: 'Failed to submit sighting'
      })
    };
  }
};

function submitToGoogleForm(url, formData) {
  return new Promise((resolve, reject) => {
    const postData = formData.toString();
    const urlObj = new URL(url);
    
    console.log('Posting to:', urlObj.hostname + urlObj.pathname);
    console.log('Post data:', postData);

    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const req = https.request(options, (res) => {
        console.log('Google Form response status:', res.statusCode);
        
        let responseBody = '';
        res.on('data', (chunk) => {
            responseBody += chunk;
        });
        
        res.on('end', () => {
            console.log('Response body length:', responseBody.length);
            if (res.statusCode >= 200 && res.statusCode < 400) {
                console.log('Form submission successful');
                resolve();
            } else {
                console.error('Form submission failed with status:', res.statusCode);
                reject(new Error(`Form submission failed: ${res.statusCode}`));
            }
        });
    });

    req.on('error', (err) => {
        console.error('Request error:', err);
        reject(err);
    });
    
    req.write(postData);
    req.end();
  });
}