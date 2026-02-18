export interface RTCSessionDescriptionInit {
    type: 'offer' | 'answer' | 'pranswer' | 'rollback';
    sdp?: string;
}

export interface OfferResponse extends RTCSessionDescriptionInit {
    peer_id: string;
}

export class SignalingClient {
    private baseUrl: string;

    constructor(url: string) {
        // Store just the base URL (without /offer)
        this.baseUrl = url.replace(/\/offer$/, '');
    }

    async sendOffer(offer: RTCSessionDescriptionInit): Promise<OfferResponse> {
        const url = `${this.baseUrl}/offer`;
        console.log(`Sending SDP Offer to ${url}`);
        try {
            const body = JSON.stringify({
                type: 'offer',
                sdp: offer.sdp,
            });

            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: body,
            });

            if (!response.ok) {
                const text = await response.text();
                throw new Error(`Signaling failed: ${response.status} ${response.statusText} - ${text}`);
            }

            const data = await response.json();
            console.log('Received SDP Answer from server');

            if (data.type !== 'answer' || !data.sdp) {
                throw new Error('Invalid SDP Answer received from server');
            }

            if (!data.peer_id) {
                console.warn('Server did not return peer_id — trickle candidates will fail');
            }

            return {
                type: 'answer',
                sdp: data.sdp,
                peer_id: data.peer_id || '',
            };
        } catch (error) {
            console.error('Signaling Error:', error);
            throw error;
        }
    }

    async sendCandidate(peerId: string, candidate: any): Promise<void> {
        if (!peerId) {
            console.warn('Cannot send candidate: no peer_id');
            return;
        }

        const url = `${this.baseUrl}/candidate`;
        console.log(`Sending ICE Candidate to ${url}`);
        try {
            await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    peer_id: peerId,
                    ...candidate,
                }),
            });
        } catch (error) {
            console.error('Candidate Signaling Error:', error);
            // Non-fatal: trickle is a fallback
        }
    }
}
