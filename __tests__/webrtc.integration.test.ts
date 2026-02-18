import { act } from '@testing-library/react-native';
import { WebRTCClient } from '../src/webrtc/peer';
import { useAppStore } from '../src/store/useAppStore';

// Mock WebRTC
// Mock WebRTC
jest.mock('react-native-webrtc', () => ({
    RTCPeerConnection: jest.fn().mockImplementation(() => {
        let iceCallback: (() => void) | null = null;
        return {
            onicecandidate: null,
            ontrack: null,
            ondatachannel: null,
            addTransceiver: jest.fn(),
            createOffer: jest.fn(() => Promise.resolve({ sdp: 'mock-offer', type: 'offer' })),
            setLocalDescription: jest.fn(() => Promise.resolve()),
            setRemoteDescription: jest.fn(() => Promise.resolve()),
            localDescription: { sdp: 'mock-offer-complete', type: 'offer' },
            iceGatheringState: 'new',
            set onicegatheringstatechange(callback: () => void) {
                iceCallback = callback;
                // Simulate ICE completion after a short delay
                setTimeout(() => {
                    // @ts-ignore
                    this.iceGatheringState = 'complete';
                    if (iceCallback) iceCallback();
                }, 10);
            },
        };
    }),
    RTCSessionDescription: jest.fn(),
    RTCSessionDescriptionInit: jest.fn(),
}));

// Mock Fetch
global.fetch = jest.fn(() =>
    Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ type: 'answer', sdp: 'mock-answer' }),
    })
) as jest.Mock;

describe('WebRTC Integration Flow (HTTP Signaling)', () => {
    let client: WebRTCClient;

    beforeEach(() => {
        useAppStore.setState({ connectionStatus: 'disconnected' });
        jest.clearAllMocks();
        client = new WebRTCClient('http://test-url/offer');
    });

    it('should connect via HTTP POST and update status', async () => {
        expect(useAppStore.getState().connectionStatus).toBe('disconnected');

        await act(async () => {
            await client.connect();
        });

        // Verify Fetch was called
        expect(global.fetch).toHaveBeenCalledWith('http://test-url/offer', expect.objectContaining({
            method: 'POST',
            body: expect.stringContaining('"type":"offer"'),
        }));

        // Verify Connection Status
        expect(useAppStore.getState().connectionStatus).toBe('connected');
    });
});
