import { 
    NOTES_PER_OCTAVE, 
    NOTES_PER_SEMITONE,
    GRID_WIDTH,
    GRID_SUBDIVISIONS,
    BEATS_PER_MEASURE,
    NOTE_HEIGHT,
    PIANO_KEY_WIDTH,
    NUM_OCTAVES,
    DEFAULT_VELOCITY,
    TOTAL_MEASURES
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
        const division = view.getUint16(offset + 12, false);
        
        // Check if using SMPTE time division
        let ticksPerQuarter;
        if (division & 0x8000) {
            // SMPTE format - not commonly used, treat as 480 ticks per quarter
            console.warn('MIDI file uses SMPTE time division, converting to ticks per quarter');
            ticksPerQuarter = 480;
        } else {
            // Ticks per quarter note
            ticksPerQuarter = division;
            
            // Sanity check - common values are 96, 120, 192, 384, 480, 960
            if (ticksPerQuarter === 0 || ticksPerQuarter > 10000) {
                console.warn(`Unusual ticks per quarter: ${ticksPerQuarter}, using default 480`);
                ticksPerQuarter = 480;
            }
        }
        
        return { format, trackCount, ticksPerQuarter };
    }
    
    /**
     * Read MIDI track chunk
     */
    static readTrackChunk(view, offset) {
        // Bounds check
        if (offset + 8 > view.byteLength) {
            throw new Error(`Invalid MIDI file: track header at offset ${offset} exceeds file size ${view.byteLength}`);
        }
        
        // Check "MTrk"
        const chunkType = this.readString(view, offset, 4);
        if (chunkType !== 'MTrk') {
            throw new Error(`Invalid MIDI file: expected MTrk, got "${chunkType}" at offset ${offset}`);
        }
        
        const chunkSize = view.getUint32(offset + 4, false);
        const events = [];
        let trackOffset = offset + 8;
        const trackEnd = trackOffset + chunkSize;
        let currentTime = 0;
        let runningStatus = null;
        
        // Validate track bounds
        if (trackEnd > view.byteLength) {
            throw new Error(`Invalid MIDI file: track data exceeds file size (track end: ${trackEnd}, file size: ${view.byteLength})`);
        }
        
        while (trackOffset < trackEnd) {
            // Read delta time
            const deltaTime = this.readVariableLength(view, trackOffset);
            trackOffset += deltaTime.bytesRead;
            currentTime += deltaTime.value;
            
            // Read event
            let statusByte = view.getUint8(trackOffset);
            let dataOffset = trackOffset + 1;
            
            // Handle running status (only valid within the same track)
            if (statusByte < 0x80) {
                if (!runningStatus) {
                    // Invalid MIDI data - skip this byte
                    trackOffset++;
                    continue;
                }
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
                const noteNum = view.getUint8(offset);
                // Validate MIDI note number (0-127)
                if (noteNum > 127) {
                    console.warn(`Invalid MIDI note number: ${noteNum}`);
                    return null;
                }
                return {
                    type: velocity === 0 ? 'noteOff' : 'noteOn',
                    time,
                    channel,
                    note: noteNum,
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
                
            case 0xF0: // System Exclusive
            case 0xF7: // System Exclusive (continuation)
                // Read length and skip
                const sysexLength = this.readVariableLength(view, offset);
                return {
                    type: 'sysex',
                    time,
                    bytesUsed: sysexLength.bytesRead + sysexLength.value
                };
                
            case 0xFF: // Meta Event
                return this.parseMetaEvent(view, offset, time);
                
            default:
                // Skip unknown events - assume 2 data bytes for channel messages
                if (eventType >= 0x80 && eventType < 0xF0) {
                    const dataBytes = (eventType >= 0xC0 && eventType < 0xE0) ? 1 : 2;
                    return {
                        type: 'unknown',
                        time,
                        bytesUsed: dataBytes
                    };
                }
                return null;
        }
    }
    
    /**
     * Parse meta event
     */
    static parseMetaEvent(view, offset, time) {
        // Bounds check
        if (offset + 2 > view.byteLength) {
            return { type: 'meta', time, bytesUsed: 1 };
        }
        
        const metaType = view.getUint8(offset);
        let length;
        let lengthBytes = 1;
        
        // Some meta events use variable length
        if (metaType === 0x00 || metaType === 0x7F) {
            const varLength = this.readVariableLength(view, offset + 1);
            length = varLength.value;
            lengthBytes = varLength.bytesRead;
        } else {
            length = view.getUint8(offset + 1);
        }
        
        // Bounds check for event data
        if (offset + 1 + lengthBytes + length > view.byteLength) {
            console.warn(`Meta event at offset ${offset} exceeds file bounds, skipping`);
            return { type: 'meta', time, bytesUsed: 2 };
        }
        
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
                    bytesUsed: length + 1 + lengthBytes
                };
                
            case 0x58: // Time Signature
                return {
                    type: 'timeSignature',
                    time,
                    numerator: view.getUint8(offset + 2),
                    denominator: Math.pow(2, view.getUint8(offset + 3)),
                    bytesUsed: length + 1 + lengthBytes
                };
                
            case 0x2F: // End of Track
                return {
                    type: 'endOfTrack',
                    time,
                    bytesUsed: length + 1 + lengthBytes
                };
                
            default:
                // Skip other meta events
                return {
                    type: 'meta',
                    time,
                    bytesUsed: length + 1 + lengthBytes
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
            // Bounds check
            if (offset + bytesRead >= view.byteLength) {
                throw new Error(`Variable length value at offset ${offset} exceeds file bounds`);
            }
            
            byte = view.getUint8(offset + bytesRead);
            value = (value << 7) | (byte & 0x7F);
            bytesRead++;
            
            // Sanity check - variable length shouldn't exceed 4 bytes
            if (bytesRead > 4) {
                throw new Error(`Invalid variable length value at offset ${offset}`);
            }
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
     * @param {number} octaveShift - Number of octaves to transpose (negative = down, positive = up)
     * @returns {Object} Piano roll data
     */
    static convertToNotes(midiData, originalBuffer, octaveShift = -1) {
        const notes = [];
        const activeNotes = new Map(); // Track active notes by key
        
        // Calculate checksum and create random generator
        const checksum = this.calculateChecksum(originalBuffer);
        const random = this.createRandom(checksum);
        
        // Track which instruments are assigned to which channels
        const channelInstruments = new Map();
        let tempo = 120; // Default tempo
        let timeSignature = { numerator: 4, denominator: 4 };
        
        // Collect all tempo and time signature changes from all tracks
        const tempoChanges = [];
        const timeSignatures = [];
        
        for (const track of midiData.tracks) {
            track.events.forEach(event => {
                if (event.type === 'setTempo') {
                    tempoChanges.push({ time: event.time, tempo: event.tempo });
                } else if (event.type === 'timeSignature') {
                    timeSignatures.push({ 
                        time: event.time, 
                        numerator: event.numerator, 
                        denominator: event.denominator 
                    });
                }
            });
        }
        
        // Sort by time
        tempoChanges.sort((a, b) => a.time - b.time);
        timeSignatures.sort((a, b) => a.time - b.time);
        
        // Use the first tempo if available
        if (tempoChanges.length > 0) {
            tempo = tempoChanges[0].tempo;
            console.log(`Found ${tempoChanges.length} tempo change(s), using initial tempo: ${tempo} BPM`);
        } else {
            console.warn('No tempo found in MIDI file, using default 120 BPM');
        }
        
        // Use the first time signature if available
        if (timeSignatures.length > 0) {
            timeSignature = {
                numerator: timeSignatures[0].numerator,
                denominator: timeSignatures[0].denominator
            };
            console.log(`Found time signature: ${timeSignature.numerator}/${timeSignature.denominator}`);
        }
        
        // Find the actual time range of the MIDI file
        const { minTime, maxTime } = this.findTimeRange(midiData.tracks);
        const timeRange = maxTime - minTime;
        
        // Calculate how many measures we need for the entire song
        const ticksPerBeat = midiData.ticksPerQuarter;
        // Use the actual time signature from the MIDI file
        const beatsPerMeasure = timeSignature.numerator;
        const ticksPerMeasure = ticksPerBeat * beatsPerMeasure;
        let measuresNeeded = Math.ceil(timeRange / ticksPerMeasure);
        
        console.log(`Ticks per beat: ${ticksPerBeat}, Beats per measure: ${beatsPerMeasure}, Ticks per measure: ${ticksPerMeasure}`);
        
        // Sanity check for measures
        if (measuresNeeded === 0 || !isFinite(measuresNeeded)) {
            console.warn(`Invalid measures calculated: ${measuresNeeded}, defaulting to 16`);
            measuresNeeded = 16;
        }
        
        // Don't auto-scale MIDI files - let them use their natural timing
        // Users can manually adjust if needed
        let scaleFactor = 1;
        
        // Only warn if the file is very long
        const maxMeasures = TOTAL_MEASURES; // 128 measures
        if (measuresNeeded > maxMeasures) {
            console.warn(`MIDI file has ${measuresNeeded} measures, which exceeds the ${maxMeasures} measure limit. Notes beyond measure ${maxMeasures} may not be visible.`);
        }
        
        // Calculate pixels per tick
        const pixelsPerTick = this.calculatePixelsPerTick(tempo, midiData.ticksPerQuarter);
        
        // Log if the time range seems unusual
        if (timeRange === 0) {
            console.warn(`Time range is 0 - all notes at the same time?`);
        } else if (timeRange > 1000000) {
            console.warn(`Very large time range detected: ${timeRange} ticks`);
        }
        
        console.log(`MIDI Format: ${midiData.format}, Tracks: ${midiData.tracks.length}`);
        console.log(`Tempo: ${tempo}, TicksPerQuarter: ${midiData.ticksPerQuarter}, TimeRange: ${minTime}-${maxTime}, PixelsPerTick: ${pixelsPerTick}`);
        
        // For Format 1 MIDI files, track 0 often contains only tempo/time signature
        // so we need to merge all tracks' events and sort by time
        const allEvents = [];
        
        // Collect all events from all tracks
        midiData.tracks.forEach((track, trackIndex) => {
            track.events.forEach(event => {
                allEvents.push({ ...event, trackIndex });
            });
        });
        
        // Sort all events by time to process them in chronological order
        allEvents.sort((a, b) => a.time - b.time);
        
        // Process all events in time order
        allEvents.forEach(event => {
            if (event.type === 'noteOn') {
                // Store note start with track info
                const key = `${event.trackIndex}-${event.channel}-${event.note}`;
                activeNotes.set(key, {
                    startTime: event.time,
                    velocity: event.velocity,
                    channel: event.channel,
                    midiNote: event.note,
                    trackIndex: event.trackIndex
                });
            } else if (event.type === 'noteOff') {
                // Complete the note - match by track, channel, and note
                const key = `${event.trackIndex}-${event.channel}-${event.note}`;
                const noteStart = activeNotes.get(key);
                if (noteStart) {
                        const duration = event.time - noteStart.startTime;
                        
                        // Convert MIDI note to 72-EDO with optional octave shift
                        const shiftedMidiNote = noteStart.midiNote + (octaveShift * 12);
                        const key72 = this.midiNoteTo72edo(shiftedMidiNote);
                        
                        // Calculate positions using pre-calculated pixelsPerTick
                        // Normalize times by subtracting minTime to start at measure 0
                        const normalizedStartTime = noteStart.startTime - minTime;
                        const normalizedEndTime = event.time - minTime;
                        
                        // For display purposes, we need to map to our 4/4 grid
                        // But preserve the actual timing relationships
                        const displayPixelsPerTick = GRID_WIDTH / midiData.ticksPerQuarter;
                        
                        const rawX = PIANO_KEY_WIDTH + (normalizedStartTime * displayPixelsPerTick);
                        const rawEndX = PIANO_KEY_WIDTH + (normalizedEndTime * displayPixelsPerTick);
                        
                        // Snap to grid
                        const x = this.snapToGrid(rawX);
                        let endX = this.snapToGrid(rawEndX);
                        
                        // Ensure minimum width
                        const minWidth = GRID_WIDTH / GRID_SUBDIVISIONS;
                        if (endX - x < minWidth) {
                            endX = x + minWidth;
                        }
                        const width = endX - x;
                        
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
                        if (notes.length < 10) {
                            console.log(`Note ${notes.length}: Track=${noteStart.trackIndex}, Ch=${noteStart.channel}, MIDI=${noteStart.midiNote}, Time=${noteStart.startTime}→${event.time}, Normalized=${normalizedStartTime}→${normalizedEndTime}, x=${x}, width=${width}`);
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
        
        // Handle any remaining active notes (orphaned note-ons)
        if (activeNotes.size > 0) {
            console.warn(`Found ${activeNotes.size} notes without note-off events`);
            // Add these notes with a reasonable default duration
            const defaultDuration = ticksPerBeat; // 1 beat duration
            
            activeNotes.forEach((noteStart, key) => {
                const endTime = noteStart.startTime + defaultDuration;
                
                // Convert MIDI note to 72-EDO with optional octave shift
                const shiftedMidiNote = noteStart.midiNote + (octaveShift * 12);
                const key72 = this.midiNoteTo72edo(shiftedMidiNote);
                
                // Calculate positions
                const normalizedStartTime = noteStart.startTime - minTime;
                const normalizedEndTime = endTime - minTime;
                
                const rawX = PIANO_KEY_WIDTH + (normalizedStartTime * pixelsPerTick);
                const rawEndX = PIANO_KEY_WIDTH + (normalizedEndTime * pixelsPerTick);
                
                // Snap to grid
                const x = this.snapToGrid(rawX);
                const endX = this.snapToGrid(rawEndX);
                const width = Math.max(GRID_WIDTH / GRID_SUBDIVISIONS, endX - x);
                
                const y = (NUM_OCTAVES * NOTES_PER_OCTAVE - 1 - key72) * NOTE_HEIGHT;
                
                notes.push({
                    x,
                    y,
                    width,
                    height: NOTE_HEIGHT,
                    key: key72,
                    velocity: noteStart.velocity,
                    pan: 0,
                    instrument: noteStart.channel === 9 ? 'ORG_D00' : 
                               (channelInstruments.get(noteStart.channel) || 'ORG_M00'),
                    pipi: 0
                });
            });
        }
        
        // Sort notes by start position for better display
        notes.sort((a, b) => a.x - b.x);
        
        // Log timing statistics
        if (notes.length > 0) {
            const notesByTrack = {};
            let totalNotes = 0;
            
            // Count notes per track/channel
            allEvents.forEach(event => {
                if (event.type === 'noteOn') {
                    const trackKey = `Track${event.trackIndex}_Ch${event.channel}`;
                    notesByTrack[trackKey] = (notesByTrack[trackKey] || 0) + 1;
                    totalNotes++;
                }
            });
            
            console.log(`MIDI Import Summary:`);
            console.log(`- Total notes: ${notes.length} created from ${totalNotes} note-on events`);
            console.log(`- Notes per track/channel:`, notesByTrack);
            console.log(`- Tempo: ${tempo} BPM`);
            console.log(`- Time range: ${minTime}-${maxTime} ticks`);
            console.log(`- Measures: ${this.calculateMeasures(notes)}`);
        }
        
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
        // In our 72-EDO system with 8 octaves (0-7):
        // - Octave 0 = MIDI notes 12-23 (C0-B0)
        // - Octave 1 = MIDI notes 24-35 (C1-B1)
        // - Octave 2 = MIDI notes 36-47 (C2-B2)
        // - Octave 3 = MIDI notes 48-59 (C3-B3)
        // - Octave 4 = MIDI notes 60-71 (C4-B4) <- Middle C
        // - Octave 5 = MIDI notes 72-83 (C5-B5)
        // - Octave 6 = MIDI notes 84-95 (C6-B6)
        // - Octave 7 = MIDI notes 96-107 (C7-B7)
        
        // Map MIDI note to our octave system
        let octave;
        if (midiNote < 12) {
            octave = 0; // Notes below C0 map to octave 0
        } else if (midiNote >= 108) {
            octave = 7; // Notes above B7 map to octave 7
        } else {
            octave = Math.floor((midiNote - 12) / 12);
        }
        
        const noteInOctave = midiNote % 12;
        
        // Each semitone = 6 steps in 72-EDO
        const key72 = octave * NOTES_PER_OCTAVE + noteInOctave * NOTES_PER_SEMITONE;
        
        // Clamp the final key to valid piano range (0-575)
        const maxKey = NUM_OCTAVES * NOTES_PER_OCTAVE - 1;
        return Math.max(0, Math.min(maxKey, key72));
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
     * Find the actual time range of notes in the MIDI file
     */
    static findTimeRange(tracks) {
        let minTime = Infinity;
        let maxTime = 0;
        
        for (const track of tracks) {
            for (const event of track.events) {
                if (event.type === 'noteOn' || event.type === 'noteOff') {
                    minTime = Math.min(minTime, event.time);
                    maxTime = Math.max(maxTime, event.time);
                }
            }
        }
        
        return { minTime: minTime === Infinity ? 0 : minTime, maxTime };
    }
    
    /**
     * Snap position to grid
     */
    static snapToGrid(x) {
        const subdivisionWidth = GRID_WIDTH / GRID_SUBDIVISIONS;
        // Round to nearest grid position
        const gridUnits = Math.round((x - PIANO_KEY_WIDTH) / subdivisionWidth);
        return gridUnits * subdivisionWidth + PIANO_KEY_WIDTH;
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