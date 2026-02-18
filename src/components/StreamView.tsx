import React from 'react';
import { View, StyleSheet } from 'react-native';
import Video from 'react-native-video';

interface StreamViewProps {
    url: string;        // e.g. "rtsp://10.165.71.121:8554/live"
}

export const StreamView: React.FC<StreamViewProps> = ({ url }) => {
    return (
        <View style={styles.container}>
            <Video
                source={{ uri: url }}
                style={styles.video}
                resizeMode="cover"
                muted={true}
                repeat={true}
                playInBackground={false}
                playWhenInactive={false}
                bufferConfig={{
                    minBufferMs: 100,
                    maxBufferMs: 500,
                    bufferForPlaybackMs: 50,
                    bufferForPlaybackAfterRebufferMs: 100,
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
    video: {
        ...StyleSheet.absoluteFillObject,
    },
});
