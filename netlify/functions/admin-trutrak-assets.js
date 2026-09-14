// Admin-only diagnostic: lists every asset on the TruTrak account so
// Nathan can find the sleigh's exact registration to enter in Season
// Settings (settings.trutrak_asset_registration, read by
// get-tracking-data.js). Replaces the old list-trutrak-assets.js, which
// had no auth at all and exposed the TruTrak fleet list to the open
// internet -- fixed here by gating on the admin role, same pattern as
// the rest of admin-*.js.
//
// Requires a logged-in Identity user with the 'admin' role.

import { getUser } from '@netlify/identity';
import { getStore } from '@netlify/blobs';
import { parseStringPromise } from 'xml2js';

const headers = { 'Content-Type': 'application/json' };
const TT_BASE = 'https://ttapi.trutrakpro.co.uk/WSDataProvider.asmx';

function requireAdmin(user) {
  return !!(user && user.roles && user.roles.includes('admin'));
}

function field(row, name, fallback = null) {
  return row[name] && row[name][0] !== undefined ? row[name][0] : fallback;
}

async function ttRequest(method, params) {
  const body = new URLSearchParams(params);
  const res = await fetch(`${TT_BASE}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });
  const text = await res.text();
  const parsed = await parseStringPromise(text);
  if (parsed.Root && parsed.Root.Error) {
    throw new Error(parsed.Root.Error[0].Error_Message[0]);
  }
  return parsed.Root;
}

async function getValidToken(store) {
  const cached = await store.get('token', { type: 'json' });
  if (cached && cached.validUntil && new Date(cached.validUntil).getTime() - Date.now() > 30 * 60 * 1000) {
    return cached.token;
  }
  const Login = process.env.TRUTRAK_LOGIN;
  const Password = process.env.TRUTRAK_PASSWORD;
  const Skey = process.env.TRUTRAK_SKEY;
  if (!Login || !Password || !Skey) {
    throw new Error('TruTrak credentials are not configured (TRUTRAK_LOGIN/TRUTRAK_PASSWORD/TRUTRAK_SKEY)');
  }
  const root = await ttRequest('TTAuthenticate', { Login, Password, Skey });
  const token = root.Authenticated[0].Token[0];
  const validUntil = root.Authenticated[0].Valid_Until[0];
  await store.setJSON('token', { token, validUntil });
  return token;
}

export default async (req, context) => {
  try {
    const user = await getUser();
    if (!requireAdmin(user)) {
      return new Response(JSON.stringify({ error: 'Admin access required' }), { status: 403, headers });
    }

    const store = getStore('trutrak');
    const token = await getValidToken(store);
    const root = await ttRequest('TTAssetsList', {
      Token: token,
      Filter_Registration: '',
      Filter_Depots: '',
      XMLType: '0'
    });
    const rows = root.Row ? (Array.isArray(root.Row) ? root.Row : [root.Row]) : [];
    const assets = rows.map((row) => ({
      id: field(row, 'ID'),
      registration: field(row, 'Reg'),
      depotId: field(row, 'Depot_ID')
    }));

    return new Response(JSON.stringify({ assets }), { status: 200, headers });
  } catch (error) {
    console.error('Error listing TruTrak assets:', error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers });
  }
};
