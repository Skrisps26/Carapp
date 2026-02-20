import React, { useState, useEffect, useRef } from 'react';
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
 *
 * A key prop forces full unmount/remount on URL change, preventing the
 * ERR_FAILED error when switching cameras rapidly.
 */
const INJECTED_JS = `
(function() {
  document.open();
  document.write('<html><body style="margin:0;padding:0;background:#000;overflow:hidden;"></body></html>');
  document.close();

  var img = document.createElement('img');
  img.style.cssText = 'width:100%;height:100%;object-fit:contain;display:block;';

  function freshSrc() {
    return '__STREAM_URL__?t=' + Date.now();
  }

  img.src = freshSrc();

  img.onload = function() {
    img.src = freshSrc();
  };

  img.onerror = function() {
    setTimeout(function() { img.src = freshSrc(); }, 200);
  };

  document.body.appendChild(img);
})();
true;
`;

export const MjpegView: React.FC<MjpegViewProps> = ({ url }) => {
  // Debounce URL changes to prevent rapid-fire reconnections
  const [activeUrl, setActiveUrl] = useState(url);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
    // Small delay to let the previous WebView fully unmount
    timerRef.current = setTimeout(() => {
      setActiveUrl(url);
    }, 150);

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, [url]);

  const frameUrl = `${activeUrl}/frame`;
  const js = INJECTED_JS.replace('__STREAM_URL__', frameUrl);

  return (
    <View style={styles.container}>
      <WebView
        key={frameUrl}
        source={{ html: '<html><body style="margin:0;padding:0;background:#000;overflow:hidden;"></body></html>' }}
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
        onError={(syntheticEvent) => {
          // Silently handle connection errors during transitions
          const { nativeEvent } = syntheticEvent;
          console.warn('WebView error (will retry):', nativeEvent.description);
        }}
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
