import * as fs from 'fs';
import * as path from 'path';
import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { IS_PUBLIC_KEY } from './public.decorator';

/**
 * Every route is behind JwtAuthGuard unless it is marked @Public(). This pins
 * the exact public list, so making a route public is a deliberate change that
 * shows up here in review, not a side effect.
 */
const EXPECTED_PUBLIC = [
  // Twilio voice: TwiML App, number webhooks and the callbacks our TwiML names
  'POST /calls/twilio/voice',
  'POST /calls/twilio/incoming',
  'POST /calls/twilio/voicemail',
  'POST /calls/twilio/voicemail/done',
  'POST /calls/twilio/voicemail/recording',
  'GET /calls/twilio/voicemail/greeting/:file',
  'POST /calls/twilio/conference-status',
  'GET /calls/twilio/ringback',
  'GET /calls/twilio/ringback.wav',
  'POST /calls/twilio/status',
  'POST /calls/twilio/recording',
  // Other providers and lead vendors
  'POST /calls/vapi-webhook',
  'POST /webhooks/mailgun/inbound',
  'POST /webhooks/propertyleads',
  'POST /webhooks/google-ads',
  'POST /webhooks/leadhouse',
  'POST /webhooks/twilio/inbound',
  'POST /webhooks/investorfuse',
  'POST /webhooks/slack-lead',
  'POST /webhooks/twilio/status',
  // Partner routes, each behind its own key guard
  'POST /external/conversations/draft-reply',
  'POST /external/ghl/webhook',
  // Links and forms used by people who are not signed in
  'GET /email/unsubscribe',
  'POST /email/unsubscribe',
  'POST /public/web-inquiries/digdeeper',
  'GET /deal-view/:token',
  'POST /auth/login',
  'POST /auth/forgot-password',
  'POST /auth/reset-password',
].sort();

function controllerFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return controllerFiles(full);
    return entry.name.endsWith('.controller.ts') ? [full] : [];
  });
}

function join(...parts: string[]): string {
  return '/' + parts.join('/').split('/').filter(Boolean).join('/');
}

describe('public routes', () => {
  it('are exactly the expected list', () => {
    const found: string[] = [];
    const srcDir = path.join(__dirname, '..');
    for (const file of controllerFiles(srcDir)) {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mod = require(file);
      for (const exported of Object.values(mod)) {
        if (typeof exported !== 'function') continue;
        const base = Reflect.getMetadata(PATH_METADATA, exported);
        if (base === undefined) continue;
        const classPublic = !!Reflect.getMetadata(IS_PUBLIC_KEY, exported);
        for (const name of Object.getOwnPropertyNames((exported as any).prototype)) {
          const handler = (exported as any).prototype[name];
          if (typeof handler !== 'function' || name === 'constructor') continue;
          const route = Reflect.getMetadata(PATH_METADATA, handler);
          if (route === undefined) continue;
          const method = RequestMethod[Reflect.getMetadata(METHOD_METADATA, handler)];
          const isPublic = Reflect.getMetadata(IS_PUBLIC_KEY, handler) ?? classPublic;
          if (isPublic) found.push(`${method} ${join(String(base), String(route))}`);
        }
      }
    }
    expect(found.sort()).toEqual(EXPECTED_PUBLIC);
  });
});
