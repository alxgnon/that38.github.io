import { 
    NOTES_PER_OCTAVE, 
    NOTES_PER_SEMITONE,
    GRID_WIDTH,
    GRID_SUBDIVISIONS,
    BEATS_PER_MEASURE,
    NOTE_HEIGHT,
    PIANO_KEY_WIDTH,
    NUM_OCTAVES,
    DEFAULT_VELOCITY
} from './constants.js';

/**
 * MIDI file parser
 */
export class MidiParser {
    /**
     * Parse a MIDI file buffer
     * @param {ArrayBuffer} buffer - MIDI file data
     * @returns {Object} Parsed MIDI data
     */
    static parse(buffer) {
        const view = new DataView(buffer);
        let offset = 0;
        
        // Read header chunk
        const header = this.readHeaderChunk(view, offset);
        offset += 14; // Header chunk size
        
        // Read track chunks
        const tracks = [];
        for (let i = 0; i < header.trackCount; i++) {
            const track = this.readTrackChunk(view, offset);
            tracks.push(track);
            offset += track.chunkSize + 8; // Track data + chunk header
        }
        
        return {
            format: header.format,
            ticksPerQuarter: header.ticksPerQuarter,
            tracks: tracks
        };
    }
    
    /**
     * Read MIDI header chunk
     */
    static readHeaderChunk(view, offset) {
        // Check "MThd"
        const chunkType = this.readString(view, offset, 4);
        if (chunkType !== 'MThd') {
            throw new Error('Invalid MIDI file: missing MThd header');
        }
        
        // Read header data
        const chunkSize = view.getUint32(offset + 4, false);
        const format = view.getUint16(offset + 8, false);
        const trackCount = view.getUint16(offset + 10, false);
        const ticksPerQuarter = view.getUint16(offset + 12, false);
        
        return { format, trackCount, ticksPerQuarter };
    }
    
    /**
     * Read MIDI track chunk
     */
    static readTrackChunk(view, offset) {
        // Check "MTrk"
        const chunkType = this.readString(view, offset, 4);
        if (chunkType !== 'MTrk') {
            throw new Error('Invalid MIDI file: missing MTrk header');
        }
        
        const chunkSize = view.getUint32(offset + 4, false);
        const events = [];
        let trackOffset = offset + 8;
        const trackEnd = trackOffset + chunkSize;
        let currentTime = 0;
        let runningStatus = null;
        
        while (trackOffset < trackEnd) {
            // Read delta time
            const deltaTime = this.readVariableLength(view, trackOffset);
            trackOffset += deltaTime.bytesRead;
            currentTime += deltaTime.value;
            
            // Read event
            let statusByte = view.getUint8(trackOffset);
            let dataOffset = trackOffset + 1;
            
            // Handle running status
            if (statusByte < 0x80) {
                statusByte = runningStatus;
                dataOffset = trackOffset;
            } else {
                runningStatus = statusByte;
            }
            
            const event = this.parseEvent(view, statusByte, dataOffset, currentTime);
            if (event) {
                events.push(event);
                trackOffset = dataOffset + event.bytesUsed;
            } else {
                trackOffset++;
            }
        }
        
        return { chunkSize, events };
    }
    
    /**
     * Parse MIDI event
     */
    static parseEvent(view, statusByte, offset, time) {
        const eventType = statusByte & 0xF0;
        const channel = statusByte & 0x0F;
        
        switch (eventType) {
            case 0x80: // Note Off
                return {
                    type: 'noteOff',
                    time,
                    channel,
                    note: view.getUint8(offset),
                    velocity: view.getUint8(offset + 1),
                    bytesUsed: 2
                };
                
            case 0x90: // Note On
                const velocity = view.getUint8(offset + 1);
                return {
                    type: velocity === 0 ? 'noteOff' : 'noteOn',
                    time,
                    channel,
                    note: view.getUint8(offset),
                    velocity,
                    bytesUsed: 2
                };
                
            case 0xB0: // Control Change
                return {
                    type: 'controlChange',
                    time,
                    channel,
                    controller: view.getUint8(offset),
                    value: view.getUint8(offset + 1),
                    bytesUsed: 2
                };
                
            case 0xC0: // Program Change
                return {
                    type: 'programChange',
                    time,
                    channel,
                    program: view.getUint8(offset),
                    bytesUsed: 1
                };
                
            case 0xFF: // Meta Event
                return this.parseMetaEvent(view, offset, time);
                
            default:
                // Skip unknown events
                return null;
        }
    }
    
    /**
     * Parse meta event
     */
    static parseMetaEvent(view, offset, time) {
        const metaType = view.getUint8(offset);
        const length = view.getUint8(offset + 1);
        
        switch (metaType) {
            case 0x51: // Set Tempo
                const microsecondsPerQuarter = 
                    (view.getUint8(offset + 2) << 16) |
                    (view.getUint8(offset + 3) << 8) |
                    view.getUint8(offset + 4);
                return {
                    type: 'setTempo',
                    time,
                    tempo: 60000000 / microsecondsPerQuarter, // BPM
                    bytesUsed: length + 2
                };
                
            case 0x58: // Time Signature
                return {
                    type: 'timeSignature',
                    time,
                    numerator: view.getUint8(offset + 2),
                    denominator: Math.pow(2, view.getUint8(offset + 3)),
                    bytesUsed: length + 2
                };
                
            case 0x2F: // End of Track
                return {
                    type: 'endOfTrack',
                    time,
                    bytesUsed: length + 2
                };
                
            default:
                // Skip other meta events
                return {
                    type: 'meta',
                    time,
                    bytesUsed: length + 2
                };
        }
    }
    
    /**
     * Read variable length value
     */
    static readVariableLength(view, offset) {
        let value = 0;
        let bytesRead = 0;
        let byte;
        
        do {
            byte = view.getUint8(offset + bytesRead);
            value = (value << 7) | (byte & 0x7F);
            bytesRead++;
        } while (byte & 0x80);
        
        return { value, bytesRead };
    }
    
    /**
     * Read string from buffer
     */
    static readString(view, offset, length) {
        let str = '';
        for (let i = 0; i < length; i++) {
            str += String.fromCharCode(view.getUint8(offset + i));
        }
        return str;
    }
    
    /**
     * Calculate checksum for buffer
     * @param {ArrayBuffer} buffer - Buffer to checksum
     * @returns {number} Checksum value
     */
    static calculateChecksum(buffer) {
        const view = new Uint8Array(buffer);
        let checksum = 0;
        for (let i = 0; i < view.length; i++) {
            checksum = ((checksum << 5) - checksum + view[i]) | 0;
        }
        return Math.abs(checksum);
    }
    
    /**
     * Simple pseudo-random number generator
     * @param {number} seed - Seed value
     * @returns {function} Random number generator function
     */
    static createRandom(seed) {
        let value = seed;
        return () => {
            value = ((value * 1103515245) + 12345) & 0x7fffffff;
            return value / 0x7fffffff;
        };
    }
    
    /**
     * Convert MIDI data to piano roll notes
     * @param {Object} midiData - Parsed MIDI data
     * @param {ArrayBuffer} originalBuffer - Original MIDI file buffer for checksum
     * @returns {Object} Piano roll data
     */
    static convertToNotes(midiData, originalBuffer) {
        const notes = [];
        const activeNotes = new Map(); // Track active notes by key
        
        // Calculate checksum and create random generator
        const checksum = this.calculateChecksum(originalBuffer);
        const random = this.createRandom(checksum);
        
        // Track which instruments are assigned to which channels
        const channelInstruments = new Map();
        let tempo = 120; // Default tempo
        let timeSignature = { numerator: 4, denominator: 4 };
        
        // First, find the initial tempo from any track
        for (const track of midiData.tracks) {
            const tempoEvent = track.events.find(e => e.type === 'setTempo');
            if (tempoEvent) {
                tempo = tempoEvent.tempo;
                break;
            }
        }
        
        // Calculate pixels per tick based on MIDI structure
        // This stays constant - we don't change it with tempo
        const pixelsPerTick = this.calculatePixelsPerTick(tempo, midiData.ticksPerQuarter);
        console.log(`Tempo: ${tempo}, TicksPerQuarter: ${midiData.ticksPerQuarter}, PixelsPerTick: ${pixelsPerTick}`);
        
        // Process all tracks
        midiData.tracks.forEach((track, trackIndex) => {
            // Process note events
            track.events.forEach(event => {
                if (event.type === 'noteOn') {
                    // Store note start
                    const key = `${event.channel}-${event.note}`;
                    activeNotes.set(key, {
                        startTime: event.time,
                        velocity: event.velocity,
                        channel: event.channel,
                        midiNote: event.note
                    });
                } else if (event.type === 'noteOff') {
                    // Complete the note
                    const key = `${event.channel}-${event.note}`;
                    const noteStart = activeNotes.get(key);
                    if (noteStart) {
                        const duration = event.time - noteStart.startTime;
                        
                        // Convert MIDI note to 72-EDO
                        const key72 = this.midiNoteTo72edo(noteStart.midiNote);
                        
                        // Calculate positions using pre-calculated pixelsPerTick
                        const rawX = PIANO_KEY_WIDTH + (noteStart.startTime * pixelsPerTick);
                        const rawEndX = PIANO_KEY_WIDTH + (event.time * pixelsPerTick);
                        
                        // Snap to grid
                        const x = this.snapToGrid(rawX);
                        const endX = this.snapToGrid(rawEndX);
                        const width = Math.max(GRID_WIDTH / GRID_SUBDIVISIONS, endX - x);
                        
                        const y = (NUM_OCTAVES * NOTES_PER_OCTAVE - 1 - key72) * NOTE_HEIGHT;
                        
                        // Map MIDI velocity (0-127) to our velocity
                        const velocity = Math.round((noteStart.velocity / 127) * 127);
                        
                        // Choose instrument based on channel
                        let instrument;
                        if (noteStart.channel === 9) {
                            // Channel 10 (9 in 0-based) is drums
                            instrument = 'ORG_D00';
                        } else {
                            // Assign or get instrument for this channel
                            if (!channelInstruments.has(noteStart.channel)) {
                                // Generate a random instrument number (0-99)
                                const instrumentNum = Math.floor(random() * 100);
                                const instrumentName = `ORG_M${instrumentNum.toString().padStart(2, '0')}`;
                                channelInstruments.set(noteStart.channel, instrumentName);
                            }
                            instrument = channelInstruments.get(noteStart.channel);
                        }
                        
                        // Log first few notes for debugging
                        if (notes.length < 5) {
                            console.log(`Note ${notes.length}: startTime=${noteStart.startTime}, endTime=${event.time}, x=${x}, y=${y}, width=${width}, key=${key72}`);
                        }
                        
                        notes.push({
                            x,
                            y,
                            width,
                            height: NOTE_HEIGHT,
                            key: key72,
                            velocity,
                            pan: 0,
                            instrument,
                            pipi: 0
                        });
                        
                        activeNotes.delete(key);
                    }
                } else if (event.type === 'timeSignature') {
                    timeSignature = {
                        numerator: event.numerator,
                        denominator: event.denominator
                    };
                }
            });
        });
        
        return {
            notes,
            tempo: Math.round(tempo),
            loopStart: 0,
            loopEnd: this.calculateMeasures(notes),
            loopEnabled: false
        };
    }
    
    /**
     * Convert MIDI note number to 72-EDO key
     */
    static midiNoteTo72edo(midiNote) {
        // MIDI note 60 = C4 (middle C)
        // MIDI note 0 = C-1 (in MIDI convention)
        // We want MIDI note 60 to map to octave 4 in our system
        
        // Adjust octave to make MIDI note 60 = C4
        const octave = Math.floor(midiNote / 12) - 1;  // Subtract 1 to align octaves
        const noteInOctave = midiNote % 12;
        
        // Clamp to valid range (0-7 octaves)
        const clampedOctave = Math.max(0, Math.min(7, octave));
        
        // Each semitone = 6 steps in 72-EDO
        return clampedOctave * NOTES_PER_OCTAVE + noteInOctave * NOTES_PER_SEMITONE;
    }
    
    /**
     * Calculate pixels per MIDI tick
     */
    static calculatePixelsPerTick(bpm, ticksPerQuarter) {
        // In MIDI, ticks are absolute time units
        // We need to convert to our grid system which is tempo-independent
        
        // Our grid: GRID_WIDTH pixels = 1 beat
        // MIDI: ticksPerQuarter ticks = 1 beat
        
        // For consistent timing, we use a fixed tempo mapping
        // This ensures notes align to our grid regardless of MIDI tempo
        const pixelsPerBeat = GRID_WIDTH;
        const pixelsPerTick = pixelsPerBeat / ticksPerQuarter;
        
        return pixelsPerTick;
    }
    
    /**
     * Snap position to grid
     */
    static snapToGrid(x) {
        const subdivisionWidth = GRID_WIDTH / GRID_SUBDIVISIONS;
        return Math.round((x - PIANO_KEY_WIDTH) / subdivisionWidth) * subdivisionWidth + PIANO_KEY_WIDTH;
    }
    
    /**
     * Calculate number of measures from notes
     */
    static calculateMeasures(notes) {
        if (notes.length === 0) return 4;
        
        const maxX = Math.max(...notes.map(n => n.x + n.width));
        const measures = Math.ceil((maxX - PIANO_KEY_WIDTH) / (GRID_WIDTH * BEATS_PER_MEASURE));
        
        return Math.max(4, measures);
    }
}