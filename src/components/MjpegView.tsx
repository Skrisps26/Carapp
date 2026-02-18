import React from 'react';
import { View, StyleSheet } from 'react-native';
import { WebView } from 'react-native-webview';

interface MjpegViewProps {
    url: string;
}

/**
 * MJPEG stream via WebView.
 *
 * We inject JS that replaces the page with a bare <img> pointing at /stream,
 * then on each 'error' or 'load' event immediately resets src to force the
 * browser to re-read the latest frame — this bypasses Android WebView's
 * internal multipart buffer that causes the 5-6 second lag.
 */
const INJECTED_JS = `
(function() {
  // Replace whatever the WebView loaded with a full-screen img
  document.open();
  document.write('<html><body style="margin:0;padding:0;background:#000;overflow:hidden;"></body></html>');
  document.close();

  var img = document.createElement('img');
  img.style.cssText = 'width:100%;height:100%;object-fit:contain;display:block;';

  // Add a cache-busting timestamp so Android doesn't serve a cached frame
  function freshSrc() {
    return '__STREAM_URL__?t=' + Date.now();
  }

  img.src = freshSrc();

  img.onload = function() {
    // Frame decoded — immediately request the next one
    img.src = freshSrc();
  };

  img.onerror = function() {
    // Connection hiccup — retry after 200ms
    setTimeout(function() { img.src = freshSrc(); }, 200);
  };

  document.body.appendChild(img);
})();
true;
`;

export const MjpegView: React.FC<MjpegViewProps> = ({ url }) => {
    const streamUrl = `${url}/stream`;
    const js = INJECTED_JS.replace('__STREAM_URL__', streamUrl);

    return (
        <View style={styles.container}>
            <WebView
                source={{ uri: streamUrl }}
                style={styles.webview}
                injectedJavaScript={js}
                javaScriptEnabled={true}
                scrollEnabled={false}
                overScrollMode="never"
                mixedContentMode="always"
                allowsInlineMediaPlayback={true}
                originWhitelist={['*']}
                startInLoadingState={false}
                scalesPageToFit={false}
                cacheEnabled={false}
                cacheMode="LOAD_NO_CACHE"
            />
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: 'black',
    },
    webview: {
        flex: 1,
        backgroundColor: 'black',
    },
});
