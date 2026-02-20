import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, View, Text, StatusBar, SafeAreaView, TouchableOpacity } from 'react-native';
import { useKeepAwake } from 'expo-keep-awake';
import * as Location from 'expo-location';
import { MjpegView } from './components/MjpegView';
import { DetectionOverlay } from './components/DetectionOverlay';
import TelemetryDashboard from './components/TelemetryDashboard';
import ControlPanel from './components/ControlPanel';
import MapDashboard from './components/MapDashboard';
import { useAppStore } from './store/useAppStore';
import { startDetectionPolling, stopDetectionPolling, setRemoteModel } from './services/InferenceClient';

// Pi MJPEG servers
const PI_FRONT_URL = "http://192.168.92.121:8080";
const PI_REAR_URL = "http://192.168.92.121:8081";

export default function App() {
    useKeepAwake();
    const inferenceEnabled = useAppStore(state => state.inferenceEnabled);
    const activeModel = useAppStore(state => state.activeModel);
    const locationSub = useRef<Location.LocationSubscription | null>(null);
    const [hudVisible, setHudVisible] = useState(true);
    const [activeCamera, setActiveCamera] = useState<'front' | 'rear' | 'frontRaw'>('front');

    let piUrl = PI_FRONT_URL;
    if (activeCamera === 'rear') piUrl = PI_REAR_URL;
    // frontRaw also uses PI_FRONT_URL because the server already serves raw frames.

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

            {/* 1. Video — full screen, always visible */}
            <View style={styles.videoLayer}>
                <MjpegView url={piUrl} />
            </View>

            {/* 2. Detection overlay — front camera only */}
            {activeCamera === 'front' && (
                <View style={styles.overlayLayer}>
                    <DetectionOverlay />
                </View>
            )}

            {/* 3. HUD Layer — togglable */}
            <View style={styles.hudLayer}>

                {/* HUD toggle — always visible, top-right */}
                <TouchableOpacity
                    style={styles.hudToggle}
                    onPress={() => setHudVisible(v => !v)}
                    activeOpacity={0.7}
                >
                    <Text style={styles.hudToggleText}>
                        {hudVisible ? '✕' : '☰'}
                    </Text>
                </TouchableOpacity>

                {hudVisible && (
                    <>
                        {/* Top-left: status badge */}
                        <View style={styles.statusBadge}>
                            <View style={styles.statusDot} />
                            <Text style={styles.statusText}>LIVE</Text>
                        </View>

                        {/* Top-center: camera toggle */}
                        <View style={styles.cameraToggleRow}>
                            <TouchableOpacity
                                style={[styles.camPill, activeCamera === 'front' ? styles.camActive : styles.camInactive]}
                                onPress={() => setActiveCamera('front')}
                            >
                                <Text style={styles.camPillText}>▶ FRONT</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                style={[styles.camPill, activeCamera === 'frontRaw' ? styles.camActive : styles.camInactive]}
                                onPress={() => setActiveCamera('frontRaw')}
                            >
                                <Text style={styles.camPillText}>▶ FRONT RAW</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                style={[styles.camPill, activeCamera === 'rear' ? styles.camActive : styles.camInactive]}
                                onPress={() => setActiveCamera('rear')}
                            >
                                <Text style={styles.camPillText}>◀ REAR</Text>
                            </TouchableOpacity>
                        </View>

                        {/* Bottom-left: telemetry */}
                        <View style={styles.bottomLeft}>
                            <TelemetryDashboard />
                        </View>

                        {/* Bottom-right: mini map + controls */}
                        <View style={styles.bottomRight}>
                            <View style={styles.miniMap}>
                                <MapDashboard />
                            </View>
                            <ControlPanel />
                        </View>
                    </>
                )}
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
    hudLayer: {
        ...StyleSheet.absoluteFillObject,
        zIndex: 3,
    },

    /* HUD toggle button — always visible */
    hudToggle: {
        position: 'absolute',
        top: 10,
        right: 12,
        width: 36,
        height: 36,
        borderRadius: 18,
        backgroundColor: 'rgba(0,0,0,0.55)',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.15)',
    },
    hudToggleText: {
        color: 'white',
        fontSize: 18,
        fontWeight: 'bold',
    },

    /* Status badge — top-left */
    statusBadge: {
        position: 'absolute',
        top: 10,
        left: 12,
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: 'rgba(0,0,0,0.5)',
        borderRadius: 12,
        paddingHorizontal: 10,
        paddingVertical: 5,
    },
    statusDot: {
        width: 7,
        height: 7,
        borderRadius: 4,
        backgroundColor: '#30D158',
        marginRight: 6,
    },
    statusText: {
        color: 'rgba(255,255,255,0.8)',
        fontWeight: 'bold',
        fontSize: 11,
        letterSpacing: 1,
    },

    /* Bottom-left: telemetry */
    bottomLeft: {
        position: 'absolute',
        bottom: 14,
        left: 12,
    },

    /* Bottom-right: map + controls */
    bottomRight: {
        position: 'absolute',
        bottom: 14,
        right: 12,
        alignItems: 'flex-end',
    },
    miniMap: {
        width: 140,
        height: 100,
        borderRadius: 8,
        overflow: 'hidden',
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.15)',
        marginBottom: 8,
    },

    /* Camera toggle — top-center */
    cameraToggleRow: {
        position: 'absolute',
        top: 10,
        left: 0,
        right: 0,
        flexDirection: 'row',
        justifyContent: 'center',
        gap: 6,
    },
    camPill: {
        paddingHorizontal: 14,
        paddingVertical: 6,
        borderRadius: 14,
    },
    camActive: {
        backgroundColor: 'rgba(0,122,255,0.85)',
    },
    camInactive: {
        backgroundColor: 'rgba(40,40,40,0.7)',
    },
    camPillText: {
        color: 'white',
        fontWeight: 'bold',
        fontSize: 11,
        letterSpacing: 0.5,
    },
});
