const FORMAT_PROFILES = Object.freeze({
  'display-responsive': Object.freeze({
    className: 'adsbygoogle adsbygoogle--display-responsive',
    minHeight: 112,
    attributes: Object.freeze({ 'data-ad-format': 'auto', 'data-full-width-responsive': 'true' }),
  }),
  multiplex: Object.freeze({
    className: 'adsbygoogle adsbygoogle--multiplex',
    minHeight: 220,
    attributes: Object.freeze({ 'data-ad-format': 'autorelaxed' }),
  }),
  'in-article': Object.freeze({
    className: 'adsbygoogle adsbygoogle--in-article',
    minHeight: 180,
    attributes: Object.freeze({ 'data-ad-layout': 'in-article', 'data-ad-format': 'fluid' }),
  }),
});

export const ADSENSE_FORMAT_NAMES = Object.freeze(Object.keys(FORMAT_PROFILES));

export function resolveAdSenseFormat(format = '') {
  const profile = FORMAT_PROFILES[format];
  if (!profile) return { valid: false, reason: 'AD_FORMAT_UNSUPPORTED' };
  return { valid: true, format, className: profile.className, minHeight: profile.minHeight, attributes: { ...profile.attributes } };
}

export function validatePlacementFormat({ placementId = '', declaredFormat = '', config = {} } = {}) {
  const configuredFormat = config.stage_two?.placements?.[placementId]?.format || '';
  if (!configuredFormat || configuredFormat !== declaredFormat) return { valid: false, reason: 'AD_FORMAT_MISMATCH' };
  return resolveAdSenseFormat(configuredFormat);
}
