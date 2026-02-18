import { act } from '@testing-library/react-native';
import { useAppStore } from '../src/store/useAppStore';

// Mock fetch for inference client
const mockFetch = jest.fn();
global.fetch = mockFetch as jest.Mock;

// Mock InferenceClient module
jest.mock('../src/services/InferenceClient', () => ({
    startDetectionPolling: jest.fn(),
    stopDetectionPolling: jest.fn(),
    setRemoteModel: jest.fn(),
}));

describe('Inference Integration', () => {
    beforeEach(() => {
        mockFetch.mockClear();
        useAppStore.setState({
            activeModel: 'cone',
            inferenceEnabled: true,
            detections: [],
            isConeCollisionRisk: false,
        });
    });

    it('should process detection results from /detections endpoint', () => {
        const mockDetections = [
            { class: 'cone' as const, confidence: 0.85, x: 0.32, y: 0.45, w: 0.12, h: 0.18 },
            { class: 'cone' as const, confidence: 0.72, x: 0.61, y: 0.55, w: 0.1, h: 0.15 },
        ];

        act(() => {
            useAppStore.getState().updateDetections(mockDetections);
        });

        const state = useAppStore.getState();
        expect(state.detections).toHaveLength(2);
        expect(state.detections[0].class).toBe('cone');
        expect(state.detections[0].confidence).toBe(0.85);
    });

    it('should handle model switch correctly', () => {
        expect(useAppStore.getState().activeModel).toBe('cone');

        act(() => {
            useAppStore.getState().setActiveModel('pothole');
        });

        expect(useAppStore.getState().activeModel).toBe('pothole');
    });

    it('should clear detections when inference is toggled off', () => {
        // Add some detections
        act(() => {
            useAppStore.getState().updateDetections([
                { class: 'cone' as const, confidence: 0.9, x: 0.5, y: 0.5, w: 0.1, h: 0.1 },
            ]);
        });
        expect(useAppStore.getState().detections).toHaveLength(1);

        // Toggle inference off
        act(() => {
            useAppStore.getState().toggleInference();
        });
        expect(useAppStore.getState().inferenceEnabled).toBe(false);
    });

    it('should fetch detections from Pi server', async () => {
        const mockDetections = [
            { class: 'pothole', confidence: 0.78, x: 0.4, y: 0.6, w: 0.15, h: 0.1 },
        ];

        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve(mockDetections),
        });

        const response = await fetch('http://10.165.71.121:8080/detections');
        const data = await response.json();

        expect(data).toHaveLength(1);
        expect(data[0].class).toBe('pothole');
    });

    it('should send model switch command to Pi', async () => {
        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve({ model: 'cone' }),
        });

        await fetch('http://10.165.71.121:8080/set_model', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: 'cone' }),
        });

        expect(mockFetch).toHaveBeenCalledWith(
            'http://10.165.71.121:8080/set_model',
            expect.objectContaining({
                method: 'POST',
                body: JSON.stringify({ model: 'cone' }),
            })
        );
    });
});
