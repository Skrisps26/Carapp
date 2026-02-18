import React from 'react';
import { View, StyleSheet } from 'react-native';
import { WebView } from 'react-native-webview';

interface MjpegViewProps {
    url: string;
}

export const MjpegView: React.FC<MjpegViewProps> = ({ url }) => {
    const html = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta name="viewport" content="width=device-width,initial-scale=1,user-scalable=no">
            <style>
                * { margin:0; padding:0; }
                body { background:#000; overflow:hidden; }
                img { width:100vw; height:100vh; object-fit:cover; }
            </style>
        </head>
        <body>
            <img src="${url}/stream" />
        </body>
        </html>
    `;

    return (
        <View style={styles.container}>
            <WebView
                source={{ html }}
                style={styles.webview}
                javaScriptEnabled={false}
                scrollEnabled={false}
                bounces={false}
                overScrollMode="never"
                allowsInlineMediaPlayback={true}
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
        backgroundColor: 'transparent',
    },
});
