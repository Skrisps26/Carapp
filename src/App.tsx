import React, { useEffect, useRef } from 'react';
import { StyleSheet, View, Text, StatusBar, SafeAreaView } from 'react-native';
import { useKeepAwake } from 'expo-keep-awake';
import * as Location from 'expo-location';
import { MjpegView } from './components/MjpegView';
import { DetectionOverlay } from './components/DetectionOverlay';
import TelemetryDashboard from './components/TelemetryDashboard';
import ControlPanel from './components/ControlPanel';
import MapDashboard from './components/MapDashboard';
import { useAppStore } from './store/useAppStore';
import { startDetectionPolling, stopDetectionPolling, setRemoteModel } from './services/InferenceClient';

// Pi MJPEG server
const PI_URL = "http://10.165.71.121:8080";

export default function App() {
    useKeepAwake();
    const inferenceEnabled = useAppStore(state => state.inferenceEnabled);
    const activeModel = useAppStore(state => state.activeModel);
    const locationSub = useRef<Location.LocationSubscription | null>(null);

    // Start/stop detection polling
    useEffect(() => {
        if (inferenceEnabled) {
            setRemoteModel(activeModel);
            startDetectionPolling();
        } else {
            setRemoteModel('off');
            stopDetectionPolling();
        }
        return () => stopDetectionPolling();
    }, [inferenceEnabled]);

    // Sync model selection to Pi
    useEffect(() => {
        if (inferenceEnabled) {
            setRemoteModel(activeModel);
        }
    }, [activeModel]);

    // GPS Location Watcher
    useEffect(() => {
        (async () => {
            const { status } = await Location.requestForegroundPermissionsAsync();
            if (status !== 'granted') {
                console.warn('Location permission denied');
                return;
            }

            locationSub.current = await Location.watchPositionAsync(
                {
                    accuracy: Location.Accuracy.High,
                    timeInterval: 1000,
                    distanceInterval: 1,
                },
                (loc) => {
                    useAppStore.getState().updateMapState({
                        latitude: loc.coords.latitude,
                        longitude: loc.coords.longitude,
                        heading: loc.coords.heading ?? 0,
                    });
                }
            );
        })();

        return () => {
            locationSub.current?.remove();
        };
    }, []);
    return (
        <SafeAreaView style={styles.container}>
            <StatusBar hidden />

            {/* 1. Video Layer — MJPEG Stream */}
            <View style={styles.videoLayer}>
                <MjpegView url={PI_URL} />
            </View>

            {/* 2. Detection Layer (Over Video) */}
            <View style={styles.overlayLayer}>
                <DetectionOverlay />
            </View>

            {/* 3. UI Dashboard Layer (Top) */}
            <View style={styles.uiLayer}>

                {/* Top Bar: Connection Status */}
                <View style={styles.topBar}>
                    <View style={[styles.statusDot, { backgroundColor: '#0F0' }]} />
                    <Text style={styles.statusText}>MJPEG LIVE</Text>
                </View>

                {/* Left Panel: Telemetry */}
                <View style={styles.leftPanel}>
                    <TelemetryDashboard />
                </View>

                {/* Right Panel: Controls + Map */}
                <View style={styles.rightPanel}>
                    <View style={styles.mapContainer}>
                        <MapDashboard />
                    </View>
                    <View style={styles.controlsContainer}>
                        <ControlPanel />
                    </View>
                </View>

            </View>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: 'black',
    },
    videoLayer: {
        ...StyleSheet.absoluteFillObject,
        zIndex: 1,
    },
    overlayLayer: {
        ...StyleSheet.absoluteFillObject,
        zIndex: 2,
    },
    uiLayer: {
        ...StyleSheet.absoluteFillObject,
        zIndex: 3,
        padding: 20,
        flexDirection: 'row',
        justifyContent: 'space-between',
    },
    topBar: {
        position: 'absolute',
        top: 20,
        left: 0,
        right: 0,
        alignItems: 'center',
        flexDirection: 'row',
        justifyContent: 'center',
    },
    statusDot: {
        width: 10,
        height: 10,
        borderRadius: 5,
        marginRight: 8,
    },
    statusText: {
        color: 'white',
        fontWeight: 'bold',
        fontSize: 16,
        textShadowColor: 'black',
        textShadowRadius: 3,
    },
    leftPanel: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'flex-start',
    },
    rightPanel: {
        flex: 1,
        justifyContent: 'space-between',
        alignItems: 'flex-end',
    },
    mapContainer: {
        width: 200,
        height: 150,
        marginBottom: 20,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: 'white',
    },
    controlsContainer: {
        //
    }
});
