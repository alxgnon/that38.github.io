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
            
            // Debug: Log first few events from each track only if no notes found
            if (track.events.length > 0) {
                const noteEvents = track.events.filter(e => e.type === 'noteOn' || e.type === 'noteOff');
                if (noteEvents.length === 0) {
                    console.log(`Track ${i}: ${track.events.length} events but no notes found`);
                    const eventTypes = {};
                    track.events.forEach(e => {
                        eventTypes[e.type] = (eventTypes[e.type] || 0) + 1;
                    });
                    console.log(`  - Event types:`, eventTypes);
                }
            }
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
                    console.warn(`Track ${offset}: Invalid running status at offset ${trackOffset}`);
                    trackOffset++;
                    continue;
                }
                statusByte = runningStatus;
                dataOffset = trackOffset;
            } else {
                // Only update running status for channel messages
                if (statusByte < 0xF0) {
                    runningStatus = statusByte;
                }
            }
            
            const event = this.parseEvent(view, statusByte, dataOffset, currentTime);
            if (event) {
                events.push(event);
                trackOffset = dataOffset + event.bytesUsed;
                
                // Debug first few events per track
                if (event.type === 'noteOn' && events.filter(e => e.type === 'noteOn').length <= 5) {
                    console.log(`Track ${Math.floor((offset-8)/8)} parsing: Found ${event.type} at time ${event.time}, ch=${event.channel}, note=${event.note}, status=0x${statusByte.toString(16)}`);
                }
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
        
        
        // Special handling for system messages
        if (statusByte === 0xF0 || statusByte === 0xF7) {
            // System exclusive
            const sysexLength = this.readVariableLength(view, offset);
            return {
                type: 'sysex',
                time,
                bytesUsed: sysexLength.bytesRead + sysexLength.value
            };
        } else if (statusByte === 0xFF) {
            // Meta event
            return this.parseMetaEvent(view, offset, time);
        }
        
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
        
        // Track which instruments are assigned to which track+channel combinations
        const trackChannelInstruments = new Map();
        // Track MIDI program changes per channel
        const channelPrograms = new Map();
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
        
        // Debug: Show what tracks contain notes
        midiData.tracks.forEach((track, i) => {
            const noteEvents = track.events.filter(e => e.type === 'noteOn');
            if (noteEvents.length > 0) {
                console.log(`Track ${i} has ${noteEvents.length} note-on events, first at time ${noteEvents[0].time}`);
            } else {
                console.log(`Track ${i} has no note events`);
            }
        });
        
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
            if (event.type === 'programChange') {
                // Track program changes per channel
                channelPrograms.set(event.channel, event.program);
                console.log(`Program change: Channel ${event.channel} → Program ${event.program} (${this.getMidiInstrumentName(event.program)})`);
            } else if (event.type === 'noteOn') {
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
                        // GRID_WIDTH represents 1 beat (quarter note), not a subdivision
                        const pixelsPerQuarterNote = GRID_WIDTH; // GRID_WIDTH = 1 beat
                        const displayPixelsPerTick = pixelsPerQuarterNote / midiData.ticksPerQuarter;
                        
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
                        let velocity = Math.round((noteStart.velocity / 127) * 127);
                        
                        // Choose instrument and pan based on channel
                        let instrument;
                        let pan = 0;
                        if (noteStart.channel === 9) {
                            // Channel 10 (9 in 0-based) is drums
                            instrument = 'ORG_D00';
                        } else {
                            // Assign or get instrument for this track+channel combination
                            const trackChannelKey = `${noteStart.trackIndex}-${noteStart.channel}`;
                            if (!trackChannelInstruments.has(trackChannelKey)) {
                                // Check if channel has a program change
                                const midiProgram = channelPrograms.get(noteStart.channel);
                                let instrumentNum;
                                
                                if (midiProgram !== undefined) {
                                    // Map MIDI program (0-127) to ORG instrument (0-99)
                                    // Using modulo to fit into ORG's instrument range
                                    instrumentNum = midiProgram % 100;
                                    // Get orchestral pan position
                                    pan = this.getOrchestralPan(midiProgram);
                                    // Apply velocity scaling for better balance
                                    const velocityScale = this.getVelocityScale(midiProgram);
                                    velocity = Math.min(127, Math.round(velocity * velocityScale));
                                } else {
                                    // No program change, use random instrument
                                    instrumentNum = Math.floor(random() * 100);
                                    pan = 0; // Center for unknown instruments
                                }
                                
                                const instrumentName = `ORG_M${instrumentNum.toString().padStart(2, '0')}`;
                                trackChannelInstruments.set(trackChannelKey, instrumentName);
                            }
                            instrument = trackChannelInstruments.get(trackChannelKey);
                            // Still need to get pan and velocity scaling for this instrument
                            const midiProgram = channelPrograms.get(noteStart.channel);
                            if (midiProgram !== undefined) {
                                pan = this.getOrchestralPan(midiProgram);
                                const velocityScale = this.getVelocityScale(midiProgram);
                                velocity = Math.min(127, Math.round(velocity * velocityScale));
                            }
                        }
                        
                        // Log first few notes for debugging
                        if (notes.length < 10) {
                            console.log(`Note ${notes.length}: Track=${noteStart.trackIndex}, Ch=${noteStart.channel}, MIDI=${noteStart.midiNote}, Vel=${noteStart.velocity}→${velocity}, Time=${noteStart.startTime}→${event.time}, x=${x}, width=${width}`);
                        }
                        
                        notes.push({
                            x,
                            y,
                            width,
                            height: NOTE_HEIGHT,
                            key: key72,
                            velocity,
                            pan,
                            instrument,
                            pipi: 0
                        });
                        
                        activeNotes.delete(key);
                } else {
                    // Note-off without matching note-on
                    console.warn(`Note-off without note-on: Track=${event.trackIndex}, Ch=${event.channel}, Note=${event.note}, Time=${event.time}`);
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
                
                // Calculate positions - don't normalize, preserve actual timing
                const normalizedStartTime = noteStart.startTime;
                const normalizedEndTime = endTime;
                
                // Use the same calculation as regular notes
                const pixelsPerQuarterNote = GRID_WIDTH * 4; // 4 subdivisions per beat
                const displayPixelsPerTick = pixelsPerQuarterNote / midiData.ticksPerQuarter;
                
                const rawX = PIANO_KEY_WIDTH + (normalizedStartTime * displayPixelsPerTick);
                const rawEndX = PIANO_KEY_WIDTH + (normalizedEndTime * displayPixelsPerTick);
                
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
            const channelsUsed = new Set();
            allEvents.forEach(event => {
                if (event.type === 'noteOn') {
                    const trackKey = `Track${event.trackIndex}_Ch${event.channel}`;
                    notesByTrack[trackKey] = (notesByTrack[trackKey] || 0) + 1;
                    totalNotes++;
                    channelsUsed.add(event.channel);
                }
            });
            
            console.log(`MIDI Import Summary:`);
            console.log(`- Total notes: ${notes.length} created from ${totalNotes} note-on events`);
            console.log(`- Notes per track/channel:`, notesByTrack);
            console.log(`- Channels used:`, Array.from(channelsUsed).sort((a, b) => a - b));
            
            // Show instrument assignments
            console.log(`- Instrument assignments:`);
            trackChannelInstruments.forEach((instrument, key) => {
                console.log(`  Track/Channel ${key} → ${instrument}`);
            });
            console.log(`- Tempo: ${tempo} BPM`);
            console.log(`- Time range: ${minTime}-${maxTime} ticks (first note at ${minTime})`);
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
        
        // Our grid: GRID_WIDTH pixels = 1 beat (quarter note)
        // MIDI: ticksPerQuarter ticks = 1 beat
        
        // For consistent timing, we use a fixed tempo mapping
        // This ensures notes align to our grid regardless of MIDI tempo
        const pixelsPerBeat = GRID_WIDTH; // GRID_WIDTH = 1 beat
        const pixelsPerTick = pixelsPerBeat / ticksPerQuarter;
        
        return pixelsPerTick;
    }
    
    /**
     * Find the actual time range of notes in the MIDI file
     */
    static findTimeRange(tracks) {
        let minTime = 0; // Always start from 0 to preserve all notes
        let maxTime = 0;
        let noteCount = 0;
        
        for (const track of tracks) {
            for (const event of track.events) {
                if (event.type === 'noteOn' || event.type === 'noteOff') {
                    maxTime = Math.max(maxTime, event.time);
                    noteCount++;
                }
            }
        }
        
        
        return { minTime, maxTime };
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
    
    /**
     * Get velocity scaling factor for MIDI instrument
     * Returns a multiplier to balance instrument volumes
     */
    static getVelocityScale(program) {
        // Accompaniment instruments typically need boosting
        // Lead/melody instruments may need reduction
        const scaleMap = {
            // Pianos - usually lead, slight reduction
            0: 0.85, 1: 0.85, 2: 0.85, 3: 0.85, 4: 0.85, 5: 0.85, 6: 0.85, 7: 0.85,
            
            // Chromatic percussion - accompaniment, boost
            8: 1.2,    // Celesta
            9: 1.1,    // Glockenspiel
            10: 1.2,   // Music Box
            11: 1.1,   // Vibraphone
            12: 1.1,   // Marimba
            13: 1.0,   // Xylophone
            14: 1.1,   // Tubular Bells
            15: 1.2,   // Dulcimer
            
            // Organs - medium
            16: 0.9, 17: 0.9, 18: 0.9, 19: 0.9, 20: 0.9, 21: 0.9, 22: 0.9, 23: 0.9,
            
            // Guitars - accompaniment, boost
            24: 1.3, 25: 1.3, 26: 1.3, 27: 1.3, 28: 1.0, 29: 0.9, 30: 0.9, 31: 1.3,
            
            // Basses - accompaniment, significant boost
            32: 1.4, 33: 1.4, 34: 1.4, 35: 1.4, 36: 1.3, 37: 1.3, 38: 1.2, 39: 1.2,
            
            // Strings
            40: 0.9,   // Violin (often lead)
            41: 1.1,   // Viola (accompaniment)
            42: 1.0,   // Cello (varies)
            43: 1.3,   // Contrabass (accompaniment)
            44: 1.0,   // Tremolo Strings
            45: 1.2,   // Pizzicato Strings (accompaniment)
            46: 1.3,   // Orchestral Harp (accompaniment)
            47: 1.0,   // Timpani
            
            // String ensembles - accompaniment
            48: 1.2, 49: 1.2, 50: 1.1, 51: 1.1,
            
            // Choir/Vocals - usually lead
            52: 0.85, 53: 0.85, 54: 0.85, 55: 0.9,
            
            // Brass - often loud already
            56: 0.8,   // Trumpet
            57: 0.8,   // Trombone
            58: 0.85,  // Tuba
            59: 0.85,  // Muted Trumpet
            60: 0.9,   // French Horn
            61: 0.85,  // Brass Section
            62: 0.85, 63: 0.85,
            
            // Woodwinds - often lead
            64: 0.9, 65: 0.9, 66: 0.9, 67: 0.95,  // Saxophones
            68: 0.95, 69: 0.95, 70: 1.0, 71: 0.95,  // Double reeds
            72: 0.9, 73: 0.9, 74: 0.95, 75: 0.95,   // Flutes
            76: 1.0, 77: 1.0, 78: 1.0, 79: 1.0,
            
            // Synth leads - reduce
            80: 0.8, 81: 0.8, 82: 0.8, 83: 0.8, 84: 0.8, 85: 0.8, 86: 0.8, 87: 0.8,
            
            // Synth pads - accompaniment, boost
            88: 1.2, 89: 1.2, 90: 1.2, 91: 1.2, 92: 1.2, 93: 1.2, 94: 1.2, 95: 1.2,
            
            // Default for others
            96: 1.0, 97: 1.0, 98: 1.0, 99: 1.0, 100: 1.0, 101: 1.0, 102: 1.0, 103: 1.0,
            104: 1.0, 105: 1.0, 106: 1.0, 107: 1.0, 108: 1.0, 109: 1.0, 110: 1.0, 111: 1.0,
            112: 1.1, 113: 1.1, 114: 1.1, 115: 1.1, 116: 1.0, 117: 1.0, 118: 1.0, 119: 1.0,
            120: 1.0, 121: 1.0, 122: 1.0, 123: 1.0, 124: 1.0, 125: 1.0, 126: 1.0, 127: 1.0
        };
        
        return scaleMap[program] || 1.0;
    }
    
    /**
     * Get orchestral pan position for MIDI instrument
     * Returns value from -100 to 100 (left to right)
     */
    static getOrchestralPan(program) {
        // Orchestra seating from audience perspective:
        // Far left: Violins 1, Flutes, Piccolo
        // Left: Violins 2, Oboes, Clarinets
        // Center-left: Violas, Bassoons
        // Center: Conductor, Piano, Harp, Vocals
        // Center-right: Cellos, Horns
        // Right: Basses, Trumpets, Trombones
        // Far right: Timpani, Percussion, Tuba
        
        const panMap = {
            // Pianos - center
            0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0,
            
            // Chromatic percussion - center to right
            8: 20,    // Celesta
            9: 40,    // Glockenspiel
            10: 0,    // Music Box
            11: 20,   // Vibraphone
            12: 40,   // Marimba
            13: 60,   // Xylophone
            14: 40,   // Tubular Bells
            15: 20,   // Dulcimer
            
            // Organs - center
            16: 0, 17: 0, 18: 0, 19: 0, 20: 0, 21: 0, 22: 0, 23: 0,
            
            // Guitars - center-left
            24: -20, 25: -20, 26: -20, 27: -20, 28: -20, 29: -20, 30: -20, 31: -20,
            
            // Basses - right
            32: 60, 33: 60, 34: 60, 35: 60, 36: 60, 37: 60, 38: 60, 39: 60,
            
            // Strings
            40: -80,  // Violin (1st violins - far left)
            41: -40,  // Viola (center-left)
            42: 40,   // Cello (center-right)
            43: 60,   // Contrabass (right)
            44: -60,  // Tremolo Strings
            45: -20,  // Pizzicato Strings
            46: 0,    // Orchestral Harp (center)
            47: 80,   // Timpani (far right)
            
            // String ensembles
            48: -60, 49: -40, 50: -40, 51: -20,
            
            // Choir/Vocals - center
            52: 0, 53: 0, 54: 0, 55: 0,
            
            // Brass
            56: 40,   // Trumpet (right)
            57: 60,   // Trombone (right)
            58: 80,   // Tuba (far right)
            59: 40,   // Muted Trumpet
            60: 20,   // French Horn (center-right)
            61: 40,   // Brass Section
            62: 40, 63: 40,
            
            // Saxophones - center-left
            64: -20, 65: -20, 66: -20, 67: -20,
            
            // Double reeds - left
            68: -60,  // Oboe
            69: -60,  // English Horn
            70: -40,  // Bassoon
            71: -60,  // Clarinet
            
            // Flutes - far left
            72: -80,  // Piccolo
            73: -80,  // Flute
            74: -60,  // Recorder
            75: -60,  // Pan Flute
            76: -40, 77: -40, 78: -40, 79: -40,
            
            // Synth leads - varied
            80: -20, 81: 20, 82: -20, 83: 20, 84: 0, 85: 0, 86: -20, 87: 20,
            
            // Synth pads - wide/center
            88: 0, 89: 0, 90: 0, 91: 0, 92: 0, 93: 0, 94: 0, 95: 0,
            
            // Sound effects - varied
            96: 0, 97: 0, 98: 0, 99: 0, 100: 0, 101: 0, 102: 0, 103: 0,
            
            // Ethnic instruments - varied
            104: -20, 105: 20, 106: -20, 107: 20, 108: 0, 109: 0, 110: -20, 111: 20,
            
            // Percussion - right side
            112: 60, 113: 60, 114: 60, 115: 60, 116: 80, 117: 80, 118: 80, 119: 80,
            
            // Sound effects
            120: 0, 121: 0, 122: 0, 123: 0, 124: 0, 125: 0, 126: 0, 127: 0
        };
        
        return panMap[program] || 0;
    }
    
    /**
     * Get MIDI instrument name from program number
     */
    static getMidiInstrumentName(program) {
        const instruments = [
            "Acoustic Grand Piano", "Bright Acoustic Piano", "Electric Grand Piano", "Honky-tonk Piano",
            "Electric Piano 1", "Electric Piano 2", "Harpsichord", "Clavi",
            "Celesta", "Glockenspiel", "Music Box", "Vibraphone",
            "Marimba", "Xylophone", "Tubular Bells", "Dulcimer",
            "Drawbar Organ", "Percussive Organ", "Rock Organ", "Church Organ",
            "Reed Organ", "Accordion", "Harmonica", "Tango Accordion",
            "Acoustic Guitar (nylon)", "Acoustic Guitar (steel)", "Electric Guitar (jazz)", "Electric Guitar (clean)",
            "Electric Guitar (muted)", "Overdriven Guitar", "Distortion Guitar", "Guitar harmonics",
            "Acoustic Bass", "Electric Bass (finger)", "Electric Bass (pick)", "Fretless Bass",
            "Slap Bass 1", "Slap Bass 2", "Synth Bass 1", "Synth Bass 2",
            "Violin", "Viola", "Cello", "Contrabass",
            "Tremolo Strings", "Pizzicato Strings", "Orchestral Harp", "Timpani",
            "String Ensemble 1", "String Ensemble 2", "SynthStrings 1", "SynthStrings 2",
            "Choir Aahs", "Voice Oohs", "Synth Voice", "Orchestra Hit",
            "Trumpet", "Trombone", "Tuba", "Muted Trumpet",
            "French Horn", "Brass Section", "SynthBrass 1", "SynthBrass 2",
            "Soprano Sax", "Alto Sax", "Tenor Sax", "Baritone Sax",
            "Oboe", "English Horn", "Bassoon", "Clarinet",
            "Piccolo", "Flute", "Recorder", "Pan Flute",
            "Blown Bottle", "Shakuhachi", "Whistle", "Ocarina",
            "Lead 1 (square)", "Lead 2 (sawtooth)", "Lead 3 (calliope)", "Lead 4 (chiff)",
            "Lead 5 (charang)", "Lead 6 (voice)", "Lead 7 (fifths)", "Lead 8 (bass + lead)",
            "Pad 1 (new age)", "Pad 2 (warm)", "Pad 3 (polysynth)", "Pad 4 (choir)",
            "Pad 5 (bowed)", "Pad 6 (metallic)", "Pad 7 (halo)", "Pad 8 (sweep)",
            "FX 1 (rain)", "FX 2 (soundtrack)", "FX 3 (crystal)", "FX 4 (atmosphere)",
            "FX 5 (brightness)", "FX 6 (goblins)", "FX 7 (echoes)", "FX 8 (sci-fi)",
            "Sitar", "Banjo", "Shamisen", "Koto",
            "Kalimba", "Bag pipe", "Fiddle", "Shanai",
            "Tinkle Bell", "Agogo", "Steel Drums", "Woodblock",
            "Taiko Drum", "Melodic Tom", "Synth Drum", "Reverse Cymbal",
            "Guitar Fret Noise", "Breath Noise", "Seashore", "Bird Tweet",
            "Telephone Ring", "Helicopter", "Applause", "Gunshot"
        ];
        
        return instruments[program] || `Program ${program}`;
    }
}