// A new widget stays empty until the app's JavaScript has started and drawn it. Android shows a provider's
// initialLayout until the first update arrives, so point each widget at its own preview image instead of the
// library's blank layout. Runs last (finalized), after react-native-android-widget has written its files.
const { withFinalizedMod } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

const WIDGETS = ['pinnednotes', 'duetasks'];

module.exports = function withWidgetPlaceholder(config) {
  return withFinalizedMod(config, [
    'android',
    async (cfg) => {
      const res = path.join(cfg.modRequest.platformProjectRoot, 'app/src/main/res');
      fs.mkdirSync(path.join(res, 'layout'), { recursive: true });
      for (const name of WIDGETS) {
        fs.writeFileSync(
          path.join(res, 'layout', `widget_loading_${name}.xml`),
          `<?xml version="1.0" encoding="utf-8"?>
<FrameLayout xmlns:android="http://schemas.android.com/apk/res/android"
    android:id="@android:id/background"
    android:layout_width="match_parent"
    android:layout_height="match_parent">
    <ImageView
        android:layout_width="match_parent"
        android:layout_height="match_parent"
        android:importantForAccessibility="no"
        android:scaleType="centerCrop"
        android:src="@drawable/${name}_preview" />
</FrameLayout>
`
        );
        const provider = path.join(res, 'xml', `widgetprovider_${name}.xml`);
        const xml = fs.readFileSync(provider, 'utf8');
        fs.writeFileSync(provider, xml.replace('@layout/rn_widget"', `@layout/widget_loading_${name}"`));
      }
      return cfg;
    },
  ]);
};
