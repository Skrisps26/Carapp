import {
    RTCPeerConnection,
    RTCIceCandidate,
    RTCSessionDescription,
    MediaStream,
} from 'react-native-webrtc';
import { SignalingClient } from './signalingClient';
import { useAppStore } from '../store/useAppStore';

const PI_IP = '10.165.71.121'; // Must match your Pi's IP

const CONFIG = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
    ],
};

const ICE_GATHER_TIMEOUT_MS = 5000;

export class WebRTCClient {
    private signaling: SignalingClient;
    private peerConnection!: RTCPeerConnection;
    private dataChannel: any;
    private peerId: string = '';
    private offerSent: boolean = false;
    public onRemoteStream?: (stream: MediaStream) => void;

    constructor(signalingUrl: string) {
        this.signaling = new SignalingClient(signalingUrl);
    }

    public async connect() {
        console.log("Starting WebRTC Connection...");
        const pc = new RTCPeerConnection(CONFIG);
        this.peerConnection = pc;

        // 1. Add Transceivers BEFORE createOffer
        console.log("Adding Transceivers...");
        pc.addTransceiver('video', { direction: 'recvonly' });
        pc.addTransceiver('audio', { direction: 'inactive' });

        // ICE state monitoring
        (pc as any).oniceconnectionstatechange = () => {
            console.log("ICE Connection State:", pc.iceConnectionState);
            if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
                useAppStore.getState().setConnectionStatus('connected');
            }
        };

        (pc as any).onconnectionstatechange = () => {
            console.log("Connection State:", (pc as any).connectionState);
        };

        // Track handler
        (pc as any).ontrack = (event: any) => {
            console.log("Track received — kind:", event.track?.kind, "enabled:", event.track?.enabled);
            if (event.streams && event.streams[0]) {
                const stream = event.streams[0];
                if (this.onRemoteStream) {
                    console.log("Passing stream to UI...");
                    this.onRemoteStream(stream);
                } else {
                    console.warn("onRemoteStream callback not set!");
                }
            } else {
                console.warn("Track event received but no streams!");
            }
        };

        // Data Channel
        (pc as any).ondatachannel = (event: any) => {
            console.log("DataChannel received:", event.channel.label);
            this.dataChannel = event.channel;
            this.setupDataChannel(this.dataChannel);
        };

        // 2. Candidate handler — trickle any late candidates
        (pc as any).onicecandidate = (event: any) => {
            if (event.candidate) {
                const c = event.candidate;
                console.log("ICE Candidate gathered:", c.candidate);

                // Only trickle if offer was already sent and we have a peer_id
                if (this.offerSent && this.peerId) {
                    this.signaling.sendCandidate(this.peerId, {
                        candidate: c.candidate,
                        sdpMid: c.sdpMid,
                        sdpMLineIndex: c.sdpMLineIndex,
                    });
                }
            } else {
                console.log("ICE Gathering Complete (null candidate)");
            }
        };

        // 3. Create Offer
        console.log("Creating Offer...");
        const offer = await pc.createOffer({});

        // 4. Set Local Description (starts ICE gathering)
        await pc.setLocalDescription(offer);
        console.log("Local description set — ICE gathering started");

        // 5. HYBRID: Wait for ICE gathering with timeout
        console.log(`Waiting up to ${ICE_GATHER_TIMEOUT_MS}ms for ICE gathering...`);
        await this.waitForIceGathering(pc, ICE_GATHER_TIMEOUT_MS);

        // 6. Get the SDP (now contains gathered candidates)
        const completeOffer = pc.localDescription;
        if (!completeOffer) throw new Error("Failed to generate SDP");

        // Log candidate count in the outgoing SDP
        const candidateLines = (completeOffer as any).sdp
            ?.split('\n')
            .filter((line: string) => line.startsWith('a=candidate:')) || [];
        console.log(`Sending offer with ${candidateLines.length} ICE candidates`);

        if (candidateLines.length === 0) {
            console.warn("WARNING: No ICE candidates in offer — connection will likely fail!");
        }

        // Check for mDNS-only candidates
        const mdnsCandidates = candidateLines.filter((c: string) => c.includes('.local'));
        const realCandidates = candidateLines.filter((c: string) => !c.includes('.local'));
        if (mdnsCandidates.length > 0 && realCandidates.length === 0) {
            console.warn("WARNING: All candidates are mDNS (.local) — aiortc cannot resolve these!");
        }

        // 7. Send Offer to server
        this.offerSent = true;
        console.log("Sending Offer via HTTP POST...");
        const response = await this.signaling.sendOffer(completeOffer as any);
        this.peerId = response.peer_id;
        console.log("Server peer_id:", this.peerId);

        // 8. Set Remote Description
        console.log("Setting Remote Description...");
        await pc.setRemoteDescription(
            new RTCSessionDescription({ type: response.type!, sdp: response.sdp! })
        );

        console.log("Signaling complete — waiting for ICE connectivity...");
    }

    private waitForIceGathering(pc: RTCPeerConnection, timeoutMs: number): Promise<void> {
        return new Promise((resolve) => {
            // Already complete
            if (pc.iceGatheringState === 'complete') {
                console.log("ICE gathering already complete");
                return resolve();
            }

            const timeout = setTimeout(() => {
                console.log(`ICE gathering timed out after ${timeoutMs}ms (state: ${pc.iceGatheringState})`);
                resolve(); // Continue with whatever candidates we have
            }, timeoutMs);

            (pc as any).onicegatheringstatechange = () => {
                console.log("ICE Gathering State:", pc.iceGatheringState);
                if (pc.iceGatheringState === 'complete') {
                    clearTimeout(timeout);
                    resolve();
                }
            };
        });
    }

    private setupDataChannel(channel: any) {
        channel.onmessage = (event: any) => {
            try {
                const data = JSON.parse(event.data);
                this.handleDataMessage(data);
            } catch (e) {
                console.error("DataChannel parse error", e);
            }
        };
    }

    private handleDataMessage(data: any) {
        const store = useAppStore.getState();
        if (data.type === 'telemetry') {
            store.updateTelemetry(data.payload);
        } else if (data.type === 'detections') {
            store.updateDetections(data.payload);
        }
    }
}
