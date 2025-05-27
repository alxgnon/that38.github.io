import { 
    BASE_FREQUENCY, 
    NOTES_PER_OCTAVE, 
    BASE_SAMPLE_RATE,
    PORTAMENTO_TIME,
    AUDIO_STOP_DELAY,
    ORG_VELOCITY_SCALE,
    MAX_DRUMS
} from './constants.js';

/**
 * Audio engine for handling all sound playback
 */
export class AudioEngine {
    constructor() {
        this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        this.masterGain = this.audioContext.createGain();
        this.masterGain.gain.value = 0.3;
        this.masterGain.connect(this.audioContext.destination);
        
        this.activeNotes = new Map();
        this.loadedSamples = new Map();
        this.wavetable = null;
        this.drums = [];
        
        // Glissando state
        this.currentGlissandoNote = null;
        this.currentGlissandoKey = null;
        
        // Tempo for envelope timing
        this.currentBPM = 120;
        
        // Default pipi values for instruments
        // pipi=0 (false) means infinite loop, pipi=1 (true) means finite loops
        // Most instruments default to infinite loop
        this.defaultPipi = new Map();
    }

    /**
     * Set master volume
     * @param {number} volume - Volume (0-100)
     */
    setMasterVolume(volume) {
        this.masterGain.gain.value = volume / 100;
    }
    
    /**
     * Set current BPM for envelope timing
     */
    setBPM(bpm) {
        this.currentBPM = bpm;
    }

    /**
     * Load wavetable data
     */
    async loadWavetable() {
        try {
            const response = await fetch('wavetable.bin');
            const buffer = await response.arrayBuffer();
            const view = new DataView(buffer);
            this.wavetable = new Int8Array(buffer);
            
            // Parse drum data
            this.drums = [];
            for (let i = 256 * 100; i < this.wavetable.length - 4; i++) {
                if (view.getUint32(i, true) === 0x45564157) { // 'WAVE'
                    i += 4;
                    const riffId = view.getUint32(i, true); i += 4;
                    const riffLen = view.getUint32(i, true); i += 4;
                    if (riffId !== 0x20746d66) { // 'fmt '
                        continue;
                    }
                    
                    const startPos = i;
                    const aFormat = view.getUint16(i, true); i += 2;
                    if (aFormat !== 1) {
                        i = startPos + riffLen;
                        continue;
                    }
                    
                    const channels = view.getUint16(i, true); i += 2;
                    if (channels !== 1) {
                        i = startPos + riffLen;
                        continue;
                    }
                    
                    const sampleRate = view.getUint32(i, true); i += 4;
                    i += 6; // Skip bytes per second and block align
                    const bits = view.getUint16(i, true); i += 2;
                    
                    // Skip to data chunk
                    while (i < this.wavetable.length - 8) {
                        const chunkId = view.getUint32(i, true); i += 4;
                        const chunkSize = view.getUint32(i, true); i += 4;
                        if (chunkId === 0x61746164) { // 'data'
                            this.drums.push({
                                filePos: i,
                                samples: chunkSize / (bits / 8),
                                bits: bits,
                                sampleRate: sampleRate
                            });
                            break;
                        }
                        i += chunkSize;
                    }
                    
                    i = startPos + riffLen + 8;
                }
            }
            
            return true;
        } catch (error) {
            return false;
        }
    }

    /**
     * Load a sample
     * @param {string} sampleName - Sample name
     */
    async loadSample(sampleName) {
        if (this.loadedSamples.has(sampleName)) {
            return this.loadedSamples.get(sampleName);
        }
        
        // If wavetable is loaded, generate buffer from it
        if (this.wavetable) {
            try {
                if (sampleName.startsWith('ORG_D')) {
                    // Handle drums
                    const drumIndex = parseInt(sampleName.substring(5));
                    if (drumIndex < this.drums.length) {
                        const drum = this.drums[drumIndex];
                        const audioBuffer = this.audioContext.createBuffer(
                            1, drum.samples, drum.sampleRate || BASE_SAMPLE_RATE
                        );
                        const channelData = audioBuffer.getChannelData(0);
                        
                        for (let i = 0; i < drum.samples; i++) {
                            if (drum.bits === 8) {
                                // 8-bit unsigned to float
                                channelData[i] = ((this.wavetable[drum.filePos + i] & 0xff) - 0x80) / 128;
                            } else if (drum.bits === 16) {
                                // 16-bit signed to float (little-endian)
                                const low = this.wavetable[drum.filePos + i * 2] & 0xff;
                                const high = this.wavetable[drum.filePos + i * 2 + 1];
                                const sample = (high << 8) | low;
                                // Convert to signed
                                const signed = sample > 32767 ? sample - 65536 : sample;
                                channelData[i] = signed / 32768;
                            }
                        }
                        
                        this.loadedSamples.set(sampleName, audioBuffer);
                        return audioBuffer;
                    }
                } else if (sampleName.startsWith('ORG_M')) {
                    // Handle melodic waves
                    const waveIndex = parseInt(sampleName.substring(5));
                    if (waveIndex <= 99) {
                        // For now, just create the basic 256-sample buffer
                        // The extended waveform with decay would need to be implemented
                        // based on the oct_wave table and pipi flag
                        const audioBuffer = this.audioContext.createBuffer(
                            1, 256, this.audioContext.sampleRate
                        );
                        const channelData = audioBuffer.getChannelData(0);
                        
                        let hasSound = false;
                        let minSample = 127;
                        let maxSample = -128;
                        for (let i = 0; i < 256; i++) {
                            // Get signed 8-bit sample
                            const sample = this.wavetable[256 * waveIndex + i];
                            // Convert to float (-1 to 1 range)
                            channelData[i] = sample / 128;
                            if (sample !== 0) hasSound = true;
                            minSample = Math.min(minSample, sample);
                            maxSample = Math.max(maxSample, sample);
                        }
                        
                        // Check if waveform is silent or very quiet
                        
                        
                        
                        this.loadedSamples.set(sampleName, audioBuffer);
                        return audioBuffer;
                    }
                }
            } catch (error) {
            }
        }
        
        // Fallback to loading WAV files
        try {
            const response = await fetch(`samples/${sampleName}.wav`);
            const arrayBuffer = await response.arrayBuffer();
            const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
            
            this.loadedSamples.set(sampleName, audioBuffer);
            return audioBuffer;
        } catch (error) {
            return null;
        }
    }

    /**
     * Calculate frequency for a given key in 72 EDO
     * @param {number} keyNumber - Key number
     */
    getFrequency(keyNumber) {
        const middleAKey = 4 * NOTES_PER_OCTAVE + 54; // A4
        const stepsFromA4 = keyNumber - middleAKey;
        const octaveOffset = stepsFromA4 / NOTES_PER_OCTAVE;
        return BASE_FREQUENCY * Math.pow(2, octaveOffset);
    }

    /**
     * Play a note
     * @param {number} keyNumber - Key number
     * @param {number} velocity - Velocity (0-127)
     * @param {string} sampleName - Sample name
     * @param {boolean} isGlissando - Whether this is a glissando note
     * @param {number} pan - Pan value (-100 to 100)
     * @param {number} when - When to play (audio context time)
     * @param {number} duration - Note duration in seconds
     */
    async playNote(keyNumber, velocity = 100, sampleName, isGlissando = false, pan = 0, when = 0, duration = 0, pipi = null) {
        // For glissando with portamento, update existing note's pitch
        if (isGlissando && this.currentGlissandoNote) {
            this.updateGlissandoPitch(keyNumber, sampleName);
            return;
        }
        
        // Handle existing note on this key
        if (this.activeNotes.has(keyNumber)) {
            const existingNote = this.activeNotes.get(keyNumber);
            if (existingNote && !existingNote.isDrum) {
                // Instead of stopping immediately, let it fade naturally
                // Set loop to false so it stops at the end of the current cycle
                if (existingNote.source && existingNote.source.loop !== undefined) {
                    existingNote.source.loop = false;
                }
                // Remove from active notes but let it play out
                this.activeNotes.delete(keyNumber);
            } else {
                // Drums stop immediately
                this.stopNote(keyNumber);
            }
        }
        
        const buffer = await this.loadSample(sampleName);
        if (!buffer) return;
        
        const startTime = when || this.audioContext.currentTime;
        const source = this.audioContext.createBufferSource();
        const gain = this.audioContext.createGain();
        const panner = this.audioContext.createStereoPanner();
        
        // Connect nodes
        source.buffer = buffer;
        source.connect(gain);
        gain.connect(panner);
        panner.connect(this.masterGain);
        
        // Set pan value
        panner.pan.value = pan / 100;
        
        // Configure based on sample type
        const isDrum = sampleName.startsWith('ORG_D');
        
        // Calculate playback rate for pitch
        source.playbackRate.value = this.calculatePlaybackRate(keyNumber, sampleName, isDrum);
        
        // Use authentic Organya volume scaling
        const orgVol = velocity * ORG_VELOCITY_SCALE;
        const authenticVolume = Math.pow(10, ((orgVol - 255) * 8) / 2000);
        
        
        // Track decay time for pipi=true instruments
        let noteDecayTime = 0;
        
        
        if (isDrum) {
            source.loop = false;
            gain.gain.setValueAtTime(authenticVolume, startTime);
        } else {
            // pipi affects looping behavior:
            // pipi=false (0 in file): loops infinitely
            // pipi=true (1 in file): loops finite times based on octave
            // Default to infinite loop if not specified
            const actualPipi = pipi !== null ? pipi : false;
            
            // Handle looping based on pipi value
            if (actualPipi === true) {
                // pipi=true: finite loops based on octave
                const octave = Math.floor(keyNumber / NOTES_PER_OCTAVE);
                const octSizes = [4, 8, 12, 16, 20, 24, 28, 32];
                const numLoops = octSizes[Math.min(octave, 7)];
                
                // Calculate when the loops would complete
                const playbackRate = this.calculatePlaybackRate(keyNumber, sampleName, false);
                const loopDuration = (256 * numLoops) / (this.audioContext.sampleRate * playbackRate);
                
                
                // Always loop the buffer
                source.loop = true;
                
                // Only cut off if loops complete before note duration
                if (loopDuration < duration) {
                    // Schedule a quick fade and stop
                    const fadeTime = 0.01; // 10ms fade
                    gain.gain.setValueAtTime(authenticVolume, startTime + loopDuration - fadeTime);
                    gain.gain.exponentialRampToValueAtTime(0.001, startTime + loopDuration);
                    source.stop(startTime + loopDuration);
                    noteDecayTime = startTime + loopDuration;
                }
            } else {
                // pipi=false: loop infinitely
                source.loop = true;
            }
            
            // Simple attack to prevent clicks
            if (duration > 0 && duration < 0.05) {
                gain.gain.setValueAtTime(authenticVolume, startTime);
            } else {
                gain.gain.setValueAtTime(0, startTime);
                gain.gain.linearRampToValueAtTime(authenticVolume, startTime + 0.002);
            }
        }
        
        // Start playback at scheduled time
        source.start(startTime);
        
        // Schedule stop if duration provided
        if (duration > 0) {
            const stopTime = startTime + duration;
            
            if (isDrum) {
                // Let drums play out naturally
            } else {
                // Schedule note off with release envelope
                // Use shorter release for very short notes
                const releaseTime = Math.min(0.1, duration * 0.2); // Max 100ms or 20% of note duration
                
                // Ensure we have enough time for the release
                if (stopTime - releaseTime > startTime + 0.002) {
                    // Don't apply release if note has already decayed
                    if (noteDecayTime === 0 || stopTime < noteDecayTime) {
                        // Cancel any scheduled changes and set current value
                        gain.gain.cancelScheduledValues(stopTime - releaseTime);
                        gain.gain.setValueAtTime(gain.gain.value, stopTime - releaseTime);
                        
                        // Release envelope
                        gain.gain.exponentialRampToValueAtTime(0.001, stopTime);
                    }
                    
                    // Stop the source after release (unless it already self-stopped)
                    if (noteDecayTime === 0 || stopTime < noteDecayTime) {
                        source.stop(stopTime + releaseTime);
                    }
                } else {
                    // Note too short for release envelope, just stop (unless it already self-stopped)
                    if (noteDecayTime === 0 || stopTime < noteDecayTime) {
                        source.stop(stopTime);
                    }
                }
            }
            
            // Return noteData for tracking
            return { source, gain, panner, isDrum, keyNumber, stopTime };
        }
        
        // Store reference for manual stopping
        const noteData = { source, gain, panner, isDrum };
        this.activeNotes.set(keyNumber, noteData);
        
        // Track for glissando if from piano keys
        if (isGlissando) {
            this.currentGlissandoNote = noteData;
            this.currentGlissandoKey = keyNumber;
        }
        
        return noteData;
    }

    /**
     * Update glissando pitch
     */
    updateGlissandoPitch(keyNumber, sampleName) {
        const isDrum = sampleName.startsWith('ORG_D');
        const targetRate = this.calculatePlaybackRate(keyNumber, sampleName, isDrum);
        
        // Smooth pitch transition
        const now = this.audioContext.currentTime;
        this.currentGlissandoNote.source.playbackRate.cancelScheduledValues(now);
        this.currentGlissandoNote.source.playbackRate.setValueAtTime(
            this.currentGlissandoNote.source.playbackRate.value, now
        );
        this.currentGlissandoNote.source.playbackRate.linearRampToValueAtTime(
            targetRate, now + PORTAMENTO_TIME
        );
        
        // Update the key reference
        this.activeNotes.delete(this.currentGlissandoKey);
        this.activeNotes.set(keyNumber, this.currentGlissandoNote);
        this.currentGlissandoKey = keyNumber;
    }

    /**
     * Calculate playback rate
     */
    calculatePlaybackRate(keyNumber, sampleName, isDrum) {
        if (isDrum) {
            const drumKey = Math.round(keyNumber / 6);
            const clampedKey = Math.max(0, Math.min(255, drumKey));
            const drumFreq = clampedKey * 800 + 100;
            return drumFreq / BASE_SAMPLE_RATE;
        } else {
            const freq = this.getFrequency(keyNumber);
            const baseKey = 4 * NOTES_PER_OCTAVE;
            const baseFreq = this.getFrequency(baseKey);
            return (freq / baseFreq) * 2 * Math.sqrt(2);
        }
    }

    /**
     * Stop a playing note
     * @param {number} keyNumber - Key number
     */
    stopNote(keyNumber) {
        const note = this.activeNotes.get(keyNumber);
        if (note) {
            // Immediately remove from active notes
            this.activeNotes.delete(keyNumber);
            
            try {
                const now = this.audioContext.currentTime;
                
                if (note.isDrum) {
                    // Drums stop immediately
                    note.source.stop(now + AUDIO_STOP_DELAY);
                    note.gain.gain.setValueAtTime(0, now + AUDIO_STOP_DELAY);
                } else {
                    // Melodic instruments use very short release to maintain articulation
                    const releaseTime = 0.005; // 5ms release for sharper cutoff
                    note.gain.gain.cancelScheduledValues(now);
                    note.gain.gain.setValueAtTime(note.gain.gain.value, now);
                    note.gain.gain.linearRampToValueAtTime(0, now + releaseTime);
                    note.source.stop(now + releaseTime + AUDIO_STOP_DELAY);
                }
                
                // Ensure cleanup happens
                setTimeout(() => {
                    try {
                        note.source.disconnect();
                        note.gain.disconnect();
                        note.panner.disconnect();
                    } catch (e) {
                        // Node might already be disconnected
                    }
                }, 50);
            } catch (e) {
                // Force cleanup on error
                try {
                    note.source.disconnect();
                    note.gain.disconnect();
                    note.panner.disconnect();
                } catch (disconnectError) {
                    // Node might already be disconnected
                }
            }
        }
    }

    /**
     * Stop all playing notes
     */
    stopAllNotes() {
        for (const [key, _] of this.activeNotes) {
            this.stopNote(key);
        }
    }

    /**
     * Get list of available samples
     */
    async getSampleList() {
        const drumSamples = [];
        const melodicSamples = [];
        
        if (this.wavetable) {
            for (let i = 0; i < this.drums.length && i < MAX_DRUMS; i++) {
                drumSamples.push(`ORG_D${i.toString().padStart(2, '0')}`);
            }
            
            for (let i = 0; i <= 99; i++) {
                melodicSamples.push(`ORG_M${i.toString().padStart(2, '0')}`);
            }
        } else {
            // Fallback to WAV files
            for (let i = 0; i < MAX_DRUMS; i++) {
                drumSamples.push(`ORG_D${i.toString().padStart(2, '0')}`);
            }
            for (let i = 0; i <= 99; i++) {
                melodicSamples.push(`ORG_M${i.toString().padStart(2, '0')}`);
            }
        }
        
        return { drumSamples, melodicSamples };
    }
}