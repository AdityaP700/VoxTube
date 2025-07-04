// Simple VoiceStream replacement - matches the API your code expects
export class VoiceStream {
    constructor(options = {}) {
        this.websocketUrl = options.websocketUrl;
        this.voiceId = options.voiceId;
        this.bufferSize = options.bufferSize || 4096;
        
        this.mediaRecorder = null;
        this.audioChunks = [];
        this.isRecording = false;
        this.stream = null;
        this.websocket = null;
        this.muted = false;
        this.eventListeners = {};
    }

    // Event system to match original API
    on(event, callback) {
        if (!this.eventListeners[event]) {
            this.eventListeners[event] = [];
        }
        this.eventListeners[event].push(callback);
    }

    emit(event, data) {
        if (this.eventListeners[event]) {
            this.eventListeners[event].forEach(callback => callback(data));
        }
    }

    async connect() {
        try {
            // Connect to WebSocket
            this.websocket = new WebSocket(this.websocketUrl);
            
            this.websocket.onopen = () => {
                this.emit('open');
                this.startRecording();
            };
            
            this.websocket.onclose = () => {
                this.emit('close');
                this.stopRecording();
            };
            
            this.websocket.onerror = (error) => {
                this.emit('error', error);
            };
            
            this.websocket.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    this.handleWebSocketMessage(data);
                } catch (e) {
                    console.error('Error parsing WebSocket message:', e);
                }
            };
            
        } catch (error) {
            this.emit('error', error);
        }
    }

    handleWebSocketMessage(data) {
        switch (data.type) {
            case 'user-transcript':
                this.emit('user-transcript', data.text);
                break;
            case 'agent-transcript':
                this.emit('agent-transcript', data.text);
                break;
            case 'agent-audio':
                // Convert base64 audio to blob if needed
                const audioData = this.base64ToArrayBuffer(data.audio);
                this.emit('agent-audio', audioData);
                break;
            default:
                console.log('Unknown message type:', data.type);
        }
    }

    base64ToArrayBuffer(base64) {
        const binaryString = window.atob(base64);
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        return bytes.buffer;
    }

    async startRecording() {
        if (this.muted) return;
        
        try {
            this.stream = await navigator.mediaDevices.getUserMedia({ 
                audio: {
                    sampleRate: 16000,
                    channelCount: 1,
                    echoCancellation: true,
                    noiseSuppression: true
                }
            });
            
            this.mediaRecorder = new MediaRecorder(this.stream, {
                mimeType: 'audio/webm;codecs=opus'
            });
            
            this.audioChunks = [];
            
            this.mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0 && !this.muted) {
                    this.audioChunks.push(event.data);
                    this.sendAudioChunk(event.data);
                }
            };
            
            this.mediaRecorder.start(100); // Collect data every 100ms
            this.isRecording = true;
            
        } catch (error) {
            this.emit('error', error);
        }
    }

    stopRecording() {
        if (this.mediaRecorder && this.isRecording) {
            this.mediaRecorder.stop();
            this.isRecording = false;
        }
        
        if (this.stream) {
            this.stream.getTracks().forEach(track => track.stop());
            this.stream = null;
        }
    }

    sendAudioChunk(audioData) {
        if (this.websocket && this.websocket.readyState === WebSocket.OPEN) {
            // Convert audio data to base64 for sending
            const reader = new FileReader();
            reader.onload = () => {
                const base64Audio = reader.result.split(',')[1];
                this.websocket.send(JSON.stringify({
                    type: 'audio',
                    audio: base64Audio,
                    voiceId: this.voiceId
                }));
            };
            reader.readAsDataURL(audioData);
        }
    }

    sendText(text) {
        if (this.websocket && this.websocket.readyState === WebSocket.OPEN) {
            this.websocket.send(JSON.stringify({
                type: 'text',
                text: text,
                voiceId: this.voiceId
            }));
        }
    }

    mute() {
        this.muted = true;
        if (this.isRecording) {
            this.stopRecording();
        }
    }

    unmute() {
        this.muted = false;
        if (this.websocket && this.websocket.readyState === WebSocket.OPEN) {
            this.startRecording();
        }
    }

    isMuted() {
        return this.muted;
    }

    disconnect() {
        this.stopRecording();
        if (this.websocket) {
            this.websocket.close();
        }
    }
}