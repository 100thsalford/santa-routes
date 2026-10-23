# Facebook "Latest Updates" feed – setup and upkeep

The home page's **Latest Updates** panel is filled by the Netlify function
`netlify/functions/facebook-posts.js`, which reads the latest public posts from the
Super Sleigh Facebook Page via Meta's Graph API.

If the function isn't configured, or the token stops working, the page quietly falls
back to Facebook's embedded Page Plugin plus an **Open our Facebook page** button.
Nothing breaks; the panel just shows less.

## Netlify environment variables

| Name | Value |
| --- | --- |
| `FACEBOOK_PAGE_ID` | Numeric ID of the Page (Page → About → Page transparency, or Graph API Explorer: `me/accounts`) |
| `FACEBOOK_ACCESS_TOKEN` | A **Page access token** with `pages_read_engagement` (+ `pages_show_list` to look it up) |

Set them in Netlify → Site configuration → Environment variables (all deploy contexts),
then trigger a deploy.

## Getting a token that doesn't expire (once)

1. developers.facebook.com → **Create app** → type **Business**. Add the Page's
   admin as a Developer/Admin of the app. (An app in Development mode works for Page
   admins; no App Review is needed for reading your own Page. Check Meta's current docs
   if this changes.)
2. Graph API Explorer → choose your app → **Get User Access Token** with
   `pages_show_list` and `pages_read_engagement` → Generate.
3. Exchange it for a long-lived user token:
   `GET /oauth/access_token?grant_type=fb_exchange_token&client_id=APP_ID&client_secret=APP_SECRET&fb_exchange_token=SHORT_TOKEN`
   (do this from the Explorer or curl, never in site code).
4. `GET /me/accounts?fields=id,name,access_token` with the long-lived token. The
   `access_token` returned for the Super Sleigh Page is the **Page token**; it has no
   expiry. The `id` is `FACEBOOK_PAGE_ID`.
5. Optional check: Access Token Debugger (developers.facebook.com/tools/debug/accesstoken)
   should show type **Page** and **Expires: Never**.

## When the feed goes quiet

A Page token stops working if the person who made it loses their Page role, changes
their Facebook password, removes the app, or the app is deleted. The function log
(Netlify → Functions → facebook-posts) shows Facebook's error. Repeat the steps above
and update `FACEBOOK_ACCESS_TOKEN`. Using a Business Manager *system user* instead of a
personal account avoids tying the token to one person.

Keep the app secret and tokens out of Git.
