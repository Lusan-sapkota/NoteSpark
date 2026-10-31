// On the desktop some of the phone's texts say "computer" instead of "phone". The desktop turns this table on (setKeyOverrides),
// so every language gets the right wording and the build does not have to match English text in the screens.
export const DESKTOP_KEYS: Record<string, string> = {
  'app.cantOpenProfileBody': 'desktop.unreadableMessage',
  'home.openProfileFailedMessage': 'desktop.unreadableMessage',
  'profiles.cantOpenBody': 'desktop.unreadableMessage',
  'profiles.noLockDescription': 'desktop.noLockDescription',
  'editor.addImageFailedMessage': 'desktop.addImageFailedMessage',
  'settings.privacyDescription': 'desktop.privacyDescription',
  'onboarding.slide1Title': 'desktop.slide1Title',
  'onboarding.slide1Body': 'desktop.slide1Body',
  'onboarding.slide2Body': 'desktop.slide2Body',
};
