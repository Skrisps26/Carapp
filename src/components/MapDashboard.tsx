import React, { useRef, useEffect } from 'react';
import { View, StyleSheet } from 'react-native';
import { WebView } from 'react-native-webview';
import { useAppStore } from '../store/useAppStore';

const MapDashboard: React.FC = () => {
    const webRef = useRef<WebView>(null);
    const mapState = useAppStore((state) => state.mapState);

    // Push location updates to Leaflet map
    useEffect(() => {
        if (webRef.current && mapState.latitude !== 0) {
            webRef.current.injectJavaScript(`
                updatePosition(${mapState.latitude}, ${mapState.longitude}, ${mapState.heading});
                true;
            `);
        }
    }, [mapState.latitude, mapState.longitude, mapState.heading]);

    // Push path history updates
    useEffect(() => {
        if (webRef.current && mapState.pathHistory.length > 0) {
            const coords = JSON.stringify(mapState.pathHistory);
            webRef.current.injectJavaScript(`
                updatePath(${coords});
                true;
            `);
        }
    }, [mapState.pathHistory.length]);

    const html = `
<!DOCTYPE html>
<html>
<head>
    <meta name="viewport" content="width=device-width, initial-scale=1, user-scalable=no">
    <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
    <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
    <style>
        * { margin: 0; padding: 0; }
        html, body, #map { width: 100%; height: 100%; background: #1a1a2e; }
        .leaflet-control-attribution { display: none !important; }
        .leaflet-control-zoom { display: none !important; }
    </style>
</head>
<body>
    <div id="map"></div>
    <script>
        var map = L.map('map', {
            center: [0, 0],
            zoom: 17,
            zoomControl: false,
            attributionControl: false,
        });

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19,
        }).addTo(map);

        // Vehicle marker — cyan circle with direction arrow
        var vehicleIcon = L.divIcon({
            className: '',
            html: '<div style="width:18px;height:18px;background:cyan;border:2px solid white;border-radius:50%;box-shadow:0 0 8px cyan;"></div>',
            iconSize: [22, 22],
            iconAnchor: [11, 11],
        });

        var marker = null;
        var pathLine = null;
        var initialized = false;

        function updatePosition(lat, lng, heading) {
            if (!marker) {
                marker = L.marker([lat, lng], { icon: vehicleIcon }).addTo(map);
                map.setView([lat, lng], 17);
                initialized = true;
            } else {
                marker.setLatLng([lat, lng]);
                map.panTo([lat, lng], { animate: true, duration: 0.5 });
            }
        }

        function updatePath(coords) {
            var latlngs = coords.map(function(c) { return [c.latitude, c.longitude]; });
            if (pathLine) {
                pathLine.setLatLngs(latlngs);
            } else {
                pathLine = L.polyline(latlngs, {
                    color: '#00FF00',
                    weight: 3,
                    opacity: 0.8,
                }).addTo(map);
            }
        }
    </script>
</body>
</html>
    `;

    return (
        <View style={styles.container}>
            <WebView
                ref={webRef}
                source={{ html }}
                style={styles.webview}
                javaScriptEnabled={true}
                scrollEnabled={false}
                overScrollMode="never"
                originWhitelist={['*']}
                mixedContentMode="always"
            />
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        width: '100%',
        height: '100%',
        borderRadius: 10,
        overflow: 'hidden',
        borderWidth: 1,
        borderColor: '#444',
    },
    webview: {
        flex: 1,
        backgroundColor: '#1a1a2e',
    },
});

export default MapDashboard;
