// Netlify Function to fetch Facebook posts
const https = require('https');

exports.handler = async (event, context) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers,
      body: ''
    };
  }

  try {
    // Facebook Graph API credentials (set these as environment variables in Netlify)
    const PAGE_ID = process.env.FACEBOOK_PAGE_ID || '';
    const ACCESS_TOKEN = process.env.FACEBOOK_ACCESS_TOKEN || '';

    if (!PAGE_ID || !ACCESS_TOKEN) {
      // Return fallback data if no credentials configured
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: false,
          message: 'Facebook credentials not configured',
          posts: []
        })
      };
    }

    // Facebook Graph API endpoint
    const fields = 'id,message,created_time,full_picture,permalink_url';
    const url = `https://graph.facebook.com/v18.0/${PAGE_ID}/posts?fields=${fields}&limit=5&access_token=${ACCESS_TOKEN}`;

    const posts = await fetchFacebookPosts(url);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        posts: posts,
        lastUpdated: new Date().toISOString()
      })
    };

  } catch (error) {
    console.error('Error fetching Facebook posts:', error);
    
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: false,
        error: error.message,
        posts: []
      })
    };
  }
};

function fetchFacebookPosts(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        if (res.statusCode === 200) {
          const response = JSON.parse(data);
          resolve(response.data || []);
        } else {
          reject(new Error(`Facebook API error: ${res.statusCode}`));
        }
      });

    }).on('error', (err) => {
      reject(err);
    });
  });
}

/*
SETUP INSTRUCTIONS FOR FACEBOOK INTEGRATION:

This is OPTIONAL but recommended for dynamic updates. If you skip this, 
the site will show default updates instead.

Step 1: Create a Facebook App
1. Go to https://developers.facebook.com/
2. Click "My Apps" > "Create App"
3. Choose "Business" type
4. Fill in app details and create

Step 2: Get Page Access Token
1. In your app dashboard, go to Tools > Graph API Explorer
2. Select your app from dropdown
3. Click "Generate Access Token"
4. Add permissions: pages_read_engagement, pages_show_list
5. Generate token
6. Click "Access Token" dropdown > "Extend Access Token"
7. Copy the long-lived token (lasts 60 days)

Step 3: Get Your Page ID
Option A: From Facebook Page
- Go to your Facebook Page
- Click "About"
- Scroll to "Page transparency" or look for "Page ID"

Option B: Using Graph API Explorer
- In Graph API Explorer, type: me/accounts
- Click Submit
- Find your page and copy its "id"

Step 4: Add to Netlify
1. Go to Netlify site dashboard
2. Site settings > Environment variables
3. Add these variables:
   - FACEBOOK_PAGE_ID: [your page ID]
   - FACEBOOK_ACCESS_TOKEN: [your long-lived token]

Step 5: Security Notes
- NEVER commit tokens to Git
- Tokens expire every 60 days - you'll need to refresh
- For production, consider using a server-side refresh flow
- Monitor your Facebook App dashboard for usage

Alternative (Simpler but Limited):
If this seems complex, you can use Facebook's Page Plugin instead:
1. Go to https://developers.facebook.com/docs/plugins/page-plugin
2. Generate the embed code for your page
3. Add it directly to your HTML in the updates section
4. This shows posts but requires no API setup

The current implementation will gracefully fallback to static updates
if Facebook credentials aren't configured.
*/