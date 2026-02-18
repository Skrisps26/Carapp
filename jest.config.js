module.exports = {
    preset: 'jest-expo',
    setupFilesAfterEnv: ['@testing-library/react-native/extend-expect'],
    transformIgnorePatterns: [
        'node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg|react-native-maps|react-native-webrtc|react-native-webview)',
    ],
    moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json']
};
