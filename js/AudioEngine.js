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
                        // Check if this waveform might create gating
                        let silentSamples = 0;
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
    async playNote(keyNumber, velocity = 100, sampleName, isGlissando = false, pan = 0, when = 0, duration = 0, pipi = null, volumeAutomation = null, panAutomation = null, freqAdjust = 0, tickDuration = null) {
        
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
            }
            // Drums are NOT stopped - they always play out fully in Organya
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
        source.playbackRate.value = this.calculatePlaybackRate(keyNumber, sampleName, isDrum, freqAdjust);
        
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
            // pipi=0: loops infinitely
            // pipi>0: loops finite times (value indicates loop count per octave)
            // Default to infinite loop if not specified
            const actualPipi = pipi !== null ? pipi : 0;
            
            // Handle looping based on pipi value
            if (actualPipi > 0) {
                // pipi>0: finite loops based on octave and pipi value
                const octave = Math.floor(keyNumber / NOTES_PER_OCTAVE);
                // The pipi value might affect the number of loops
                // For now, using the original octave-based loop counts
                const octSizes = [4, 8, 12, 16, 20, 24, 28, 32];
                const numLoops = octSizes[Math.min(octave, 7)] * actualPipi;
                
                // Calculate when the loops would complete
                const playbackRate = this.calculatePlaybackRate(keyNumber, sampleName, false, freqAdjust);
                const loopDuration = (256 * numLoops) / (this.audioContext.sampleRate * playbackRate);
                
                
                // Always loop the buffer
                source.loop = true;
                
                // Only cut off if loops complete before note duration
                if (loopDuration < duration) {
                    // Stop immediately when loops complete
                    gain.gain.setValueAtTime(0, startTime + loopDuration);
                    source.stop(startTime + loopDuration);
                    noteDecayTime = startTime + loopDuration;
                }
            } else {
                // pipi=0: loop infinitely
                source.loop = true;
            }
            
            // Set volume immediately
            gain.gain.setValueAtTime(authenticVolume, startTime);
            
            // Apply volume automation if provided
            if (volumeAutomation && volumeAutomation.length > 0) {
                // Sort automation points by tick position
                const sortedAutomation = [...volumeAutomation].sort((a, b) => a.tick - b.tick);
                
                // Use provided tick duration or calculate from note duration
                const actualTickDuration = tickDuration || (duration / Math.max(...sortedAutomation.map(p => p.tick), 1));
                
                sortedAutomation.forEach((point, index) => {
                    const time = startTime + (point.tick * actualTickDuration);
                    const vol = point.volume * ORG_VELOCITY_SCALE;
                    const automationVolume = Math.pow(10, ((vol - 255) * 8) / 2000);
                    
                    // For gating effects, use setValueAtTime for instant changes
                    // instead of ramping which can make it sound mushy
                    if (index === 0) {
                        // First point - ramp from current value
                        gain.gain.setValueAtTime(gain.gain.value, time - 0.001);
                        gain.gain.linearRampToValueAtTime(automationVolume, time);
                    } else {
                        // Subsequent points - instant change for tighter gating
                        gain.gain.setValueAtTime(automationVolume, time);
                    }
                });
            }
            
            // Apply pan automation if provided
            if (panAutomation && panAutomation.length > 0) {
                const sortedPanAutomation = [...panAutomation].sort((a, b) => a.tick - b.tick);
                const actualTickDuration = tickDuration || (duration / Math.max(...sortedPanAutomation.map(p => p.tick), 1));
                
                sortedPanAutomation.forEach(point => {
                    const time = startTime + (point.tick * actualTickDuration);
                    panner.pan.linearRampToValueAtTime(point.pan / 100, time);
                });
            }
        }
        
        // Start playback at scheduled time
        source.start(startTime);
        
        // Schedule stop if duration provided
        if (duration > 0 && !isDrum) {
            const stopTime = startTime + duration;
            
            // Stop immediately at scheduled time (only for melodic instruments)
            source.stop(stopTime);
            gain.gain.setValueAtTime(0, stopTime);
            
            // Return noteData for tracking
            return { source, gain, panner, isDrum, keyNumber, stopTime };
        }
        
        // Store reference for manual stopping (only melodic instruments)
        const noteData = { source, gain, panner, isDrum };
        if (!isDrum) {
            this.activeNotes.set(keyNumber, noteData);
        }
        
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
        const targetRate = this.calculatePlaybackRate(keyNumber, sampleName, isDrum, 0);
        
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
    calculatePlaybackRate(keyNumber, sampleName, isDrum, freqAdjust = 0) {
        if (isDrum) {
            const drumKey = Math.round(keyNumber / 6);
            const clampedKey = Math.max(0, Math.min(255, drumKey));
            const drumFreq = clampedKey * 800 + 100;
            return drumFreq / BASE_SAMPLE_RATE;
        } else {
            // Organya pitch system implementation
            // Base point frequencies for each pitch class (C through B)
            const basePointFreqs = [33408, 35584, 37632, 39808, 42112, 44672, 47488, 50048, 52992, 56320, 59648, 63232];
            
            // Period sizes for each octave
            const periodSizes = [1024, 512, 256, 128, 64, 32, 16, 8];
            
            // Extract octave and pitch class from key number
            const octave = Math.floor(keyNumber / NOTES_PER_OCTAVE);
            const microtonalPosition = keyNumber % NOTES_PER_OCTAVE;
            // Round to nearest semitone (6 microtones per semitone in 72-EDO)
            const pitchClassIndex = Math.round(microtonalPosition / 6) % 12;
            
            // Clamp values to valid ranges
            const clampedOctave = Math.max(0, Math.min(7, octave));
            const clampedPitchClass = Math.max(0, Math.min(11, pitchClassIndex));
            
            // Calculate point frequency with freq adjustment
            // freqAdjust is already (pitch - 1000) from OrgParser
            const pointFrequency = basePointFreqs[clampedPitchClass] + freqAdjust;
            
            // Calculate actual frequency using period size
            const organyaFreq = pointFrequency / periodSizes[clampedOctave];
            
            // The wavetable samples are 256 samples at the base sample rate
            // We need to calculate the playback rate to achieve the target frequency
            // organyaFreq is in Hz (periods per second)
            // For a 256-sample waveform, one period at playback rate 1.0 takes 256/sampleRate seconds
            // To get organyaFreq Hz, we need: playbackRate = organyaFreq * 256 / sampleRate
            return (organyaFreq * 256) / this.audioContext.sampleRate;
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
                    // Stop melodic instruments immediately
                    note.source.stop(now + AUDIO_STOP_DELAY);
                    note.gain.gain.setValueAtTime(0, now + AUDIO_STOP_DELAY);
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