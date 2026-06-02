const NAMESPACED_CUSTOM_CLAIM_PATTERN = /^(https?:\/\/|urn:)/i;

export type AuthSessionUserPayload = {
  sub: unknown;
  email: unknown;
  name: unknown;
  email_verified: unknown;
  has_email_verified_claim: boolean;
  claim_keys: string[];
  custom_claim_keys: string[];
  has_custom_claims: boolean;
  custom_claims: Record<string, unknown>;
};

export function buildAuthSessionUserPayload(
  user: Record<string, unknown>
): AuthSessionUserPayload {
  const claimKeys = Object.keys(user).sort((a, b) => a.localeCompare(b));
  const customClaimKeys = claimKeys.filter((key) =>
    NAMESPACED_CUSTOM_CLAIM_PATTERN.test(key)
  );
  const customClaims = Object.fromEntries(
    customClaimKeys.map((key) => [key, user[key]])
  );

  return {
    sub: user.sub ?? null,
    email: user.email ?? null,
    name: user.name ?? null,
    email_verified: user.email_verified ?? null,
    has_email_verified_claim: Object.prototype.hasOwnProperty.call(
      user,
      "email_verified"
    ),
    claim_keys: claimKeys,
    custom_claim_keys: customClaimKeys,
    has_custom_claims: customClaimKeys.length > 0,
    custom_claims: customClaims,
  };
}
