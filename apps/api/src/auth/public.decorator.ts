import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';
export const ORG_OPTIONAL_KEY = 'orgOptional';

/**
 * A route anyone may call without signing in: a provider webhook, a link in
 * an email, the login form. Every other route needs a valid token (see
 * JwtAuthGuard). Routes that use this are expected to check the caller some
 * other way where they can: a Twilio or Mailgun signature, a partner API key,
 * a signed link.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/**
 * A signed-in route that also works for a user with no organization, so such
 * an account can still load itself and change its password. Everything else
 * needs an organization, because most queries only filter by org when there
 * is one: an org-less token would otherwise see every company's data.
 */
export const OrgOptional = () => SetMetadata(ORG_OPTIONAL_KEY, true);
