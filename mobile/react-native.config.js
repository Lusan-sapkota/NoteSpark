// onnxruntime-react-native ships a unimodule.json, so Expo autolinking takes it for an Expo module that
// conflicts with its own gradle file and skips it: the native module (search by meaning) was built into
// the app but never registered. An explicit (empty) Android entry makes autolinking link it normally.
module.exports = {
  dependencies: {
    'onnxruntime-react-native': {
      platforms: { android: {} },
    },
  },
};
