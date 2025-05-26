import { 
    ORG_FILE_SIGNATURE,
    ORG_VERSION,
    ORG_MAX_KEY,
    NOTES_PER_OCTAVE,
    NOTES_PER_SEMITONE,
    PIANO_KEY_WIDTH,
    GRID_WIDTH,
    BEATS_PER_MEASURE,
    NOTE_HEIGHT,
    NUM_OCTAVES
} from './constants.js';

/**
 * Parser for Organya (.org) music files
 */
export class OrgParser {
    /**
     * Parse an ORG file
     * @param {ArrayBuffer} buffer - File buffer
     * @returns {Object} Parsed data
     */
    static parse(buffer) {
        const view = new DataView(buffer);
        let offset = 0;
        
        // Check minimum file size
        if (buffer.byteLength < 18) {
            throw new Error('File too small to be a valid ORG file');
        }
        
        // Read header
        const header = this.readHeader(view, offset);
        offset += 18;
        
        if (header.signature !== ORG_FILE_SIGNATURE) {
            throw new Error('Invalid ORG file signature');
        }
        
        // Read instruments
        const instruments = this.readInstruments(view, offset);
        offset += 16 * 6; // 16 tracks * 6 bytes each
        
        // Read all track data
        const tracks = this.readAllTracks(view, offset, instruments);
        
        return {
            header,
            instruments,
            tracks,
            tempo: header.wait // 'wait' is the tempo field
        };
    }

    /**
     * Read file header
     */
    static readHeader(view, offset) {
        // Check if we have enough bytes for header
        if (view.byteLength < offset + 18) {
            throw new Error('Invalid ORG file: not enough data for header');
        }
        
        const decoder = new TextDecoder('ascii');
        const signatureBytes = new Uint8Array(view.buffer, offset, 6);
        const signature = decoder.decode(signatureBytes);
        
        return {
            signature: signature,
            wait: view.getUint16(offset + 6, true), // 'wait' is the tempo field in ORG
            stepsPerBar: view.getUint8(offset + 8),
            beatsPerStep: view.getUint8(offset + 9),
            loopStart: view.getUint32(offset + 10, true),
            loopEnd: view.getUint32(offset + 14, true)
        };
    }

    /**
     * Read instrument data
     */
    static readInstruments(view, offset) {
        // Check if we have enough bytes for instruments
        if (view.byteLength < offset + 16 * 6) {
            throw new Error('Invalid ORG file: not enough data for instruments');
        }
        
        const instruments = [];
        
        for (let i = 0; i < 16; i++) {
            const inst = {
                pitch: view.getUint16(offset + i * 6, true),
                instrument: view.getUint8(offset + i * 6 + 2),
                pipi: view.getUint8(offset + i * 6 + 3) !== 0,
                noteCount: view.getUint16(offset + i * 6 + 4, true)
            };
            instruments.push(inst);
        }
        
        return instruments;
    }

    /**
     * Read all track data
     */
    static readAllTracks(view, offset, instruments) {
        const tracks = [];
        
        // Read track data for each instrument
        for (let i = 0; i < 16; i++) {
            const noteCount = instruments[i].noteCount;
            const track = {
                noteCount: noteCount,
                notes: []
            };
            
            if (noteCount > 0) {
                // Initialize note array
                for (let j = 0; j < noteCount; j++) {
                    track.notes.push({ position: 0, key: 0, length: 0, volume: 0, pan: 0 });
                }
                
                // Read positions for all notes in this track
                for (let j = 0; j < noteCount; j++) {
                    if (offset + 4 > view.byteLength) {
                        throw new Error(`Invalid ORG file: not enough data for track ${i} positions`);
                    }
                    track.notes[j].position = view.getUint32(offset, true);
                    offset += 4;
                }
                
                // Read keys for all notes in this track
                for (let j = 0; j < noteCount; j++) {
                    if (offset + 1 > view.byteLength) {
                        throw new Error(`Invalid ORG file: not enough data for track ${i} keys`);
                    }
                    track.notes[j].key = view.getUint8(offset);
                    offset += 1;
                }
                
                // Read lengths for all notes in this track
                for (let j = 0; j < noteCount; j++) {
                    if (offset + 1 > view.byteLength) {
                        throw new Error(`Invalid ORG file: not enough data for track ${i} lengths`);
                    }
                    track.notes[j].length = view.getUint8(offset);
                    offset += 1;
                }
                
                // Read volumes for all notes in this track
                for (let j = 0; j < noteCount; j++) {
                    if (offset + 1 > view.byteLength) {
                        throw new Error(`Invalid ORG file: not enough data for track ${i} volumes`);
                    }
                    track.notes[j].volume = view.getUint8(offset);
                    offset += 1;
                }
                
                // Read pan values for all notes in this track
                for (let j = 0; j < noteCount; j++) {
                    if (offset + 1 > view.byteLength) {
                        throw new Error(`Invalid ORG file: not enough data for track ${i} pan values`);
                    }
                    track.notes[j].pan = view.getUint8(offset);
                    offset += 1;
                }
                
                // Filter out notes with key = 255 (no note)
                track.notes = track.notes.filter(note => note.key !== 255);
            }
            
            tracks.push(track);
        }
        
        return tracks;
    }

    /**
     * Convert ORG data to piano roll notes
     * @param {Object} orgData - Parsed ORG data
     * @param {number} targetBpm - Target BPM for display
     * @returns {Object} Converted data
     */
    static convertToNotes(orgData, targetBpm = 120) {
        const notes = [];
        const { header, instruments, tracks } = orgData;
        
        // Debug: Check instrument settings
        console.log('=== Instrument Settings ===');
        instruments.forEach((inst, i) => {
            console.log(`Track ${i}: instrument=${inst.instrument}, pipi=${inst.pipi}, pitch=${inst.pitch}`);
        });
        
        // ORG 'wait' value represents milliseconds per tick
        // Lower wait = faster tempo
        const msPerTick = header.wait;
        const ticksPerBeat = header.stepsPerBar * header.beatsPerStep / 4; // Assuming 4/4 time
        const orgBpm = 60000 / (msPerTick * ticksPerBeat);
        
        // Calculate pixel scaling
        const pixelsPerBeat = GRID_WIDTH;
        const pixelsPerTick = pixelsPerBeat / ticksPerBeat;
        
        // Convert each track
        tracks.forEach((track, trackIndex) => {
            if (track.notes.length === 0) return;
            
            const instrument = instruments[trackIndex];
            const instrumentName = this.getInstrumentName(instrument.instrument, trackIndex);
            
            track.notes.forEach(note => {
                // Convert position (in ticks) to pixels
                const x = PIANO_KEY_WIDTH + (note.position * pixelsPerTick);
                
                // Convert ORG key to 72edo key
                const key72 = this.convertKeyTo72edo(note.key);
                const y = (NUM_OCTAVES * NOTES_PER_OCTAVE - 1 - key72) * NOTE_HEIGHT;
                
                // Convert length (in ticks) to pixels
                const width = Math.max(GRID_WIDTH / 4, note.length * pixelsPerTick);
                
                // Convert volume (0-254 in ORG to 0-127 MIDI velocity)
                const velocity = Math.round(note.volume / 2);
                
                // Convert pan (0-12 in ORG, 6 = center)
                // 255 is a special value meaning "no pan" or "default center"
                let pan = 0;
                if (note.pan !== 255 && note.pan <= 12) {
                    pan = (note.pan - 6) * 100 / 6;
                }
                
                notes.push({
                    x,
                    y,
                    width,
                    height: NOTE_HEIGHT,
                    key: key72,
                    velocity,
                    pan,
                    instrument: instrumentName,
                    pipi: instrument.pipi  // Pass through the pipi flag
                });
            });
        });
        
        // Calculate loop points in measures
        const loopStart = Math.floor(header.loopStart * pixelsPerTick / (GRID_WIDTH * BEATS_PER_MEASURE));
        const loopEnd = Math.floor(header.loopEnd * pixelsPerTick / (GRID_WIDTH * BEATS_PER_MEASURE));
        
        return {
            notes,
            tempo: Math.round(orgBpm), // Convert from wait value to BPM
            loopStart,
            loopEnd,
            loopEnabled: header.loopEnd > header.loopStart
        };
    }

    /**
     * Convert ORG key (0-95) to 72edo key
     */
    static convertKeyTo72edo(orgKey) {
        if (orgKey > ORG_MAX_KEY) return 0;
        
        // ORG uses standard 12-TET keys
        // Map to nearest 72edo equivalent
        const octave = Math.floor(orgKey / 12);
        const noteInOctave = orgKey % 12;
        
        // Each semitone in 72edo = 6 steps
        // Place notes on exact semitone positions
        return octave * NOTES_PER_OCTAVE + noteInOctave * NOTES_PER_SEMITONE;
    }

    /**
     * Get instrument name from ORG instrument number
     */
    static getInstrumentName(instrumentNum, trackIndex) {
        // First 8 tracks are melodic, last 8 are drums
        if (trackIndex < 8) {
            // Melodic instruments
            if (instrumentNum <= 99) {
                return `ORG_M${instrumentNum.toString().padStart(2, '0')}`;
            }
        } else {
            // Drum tracks
            const drumIndex = trackIndex - 8;
            if (drumIndex < 6) {
                return `ORG_D${drumIndex.toString().padStart(2, '0')}`;
            }
        }
        
        // Default to first melodic instrument
        return 'ORG_M00';
    }

    /**
     * Create ORG file from notes
     * @param {Array} notes - Note array
     * @param {Object} settings - Export settings
     * @returns {ArrayBuffer} ORG file data
     */
    static createOrgFile(notes, settings = {}) {
        // Group notes by instrument/track
        const trackMap = new Map();
        
        notes.forEach(note => {
            if (!trackMap.has(note.instrument)) {
                trackMap.set(note.instrument, []);
            }
            trackMap.get(note.instrument).push(note);
        });
        
        // Create tracks (max 16)
        const tracks = [];
        let trackIndex = 0;
        
        for (const [instrument, trackNotes] of trackMap) {
            if (trackIndex >= 16) break;
            
            // Sort notes by position
            trackNotes.sort((a, b) => a.x - b.x);
            
            // Convert notes to ORG format
            const orgNotes = trackNotes.map(note => ({
                position: Math.round((note.x - PIANO_KEY_WIDTH) / (GRID_WIDTH / 4)),
                key: this.convert72edoToOrgKey(note.key),
                length: Math.round(note.width / (GRID_WIDTH / 4)),
                volume: Math.min(254, note.velocity * 2),
                pan: Math.round(note.pan * 6 / 100 + 6)
            }));
            
            tracks.push({
                instrument,
                notes: orgNotes,
                instrumentNum: this.getInstrumentNumber(instrument),
                isDrum: instrument.startsWith('ORG_D')
            });
            
            trackIndex++;
        }
        
        // Pad with empty tracks
        while (tracks.length < 16) {
            tracks.push({ notes: [], instrumentNum: 0, isDrum: false });
        }
        
        // Calculate file size
        const headerSize = 18 + 16 * 6; // Header + instruments
        const trackDataSize = tracks.reduce((sum, track) => 
            sum + 4 + track.notes.length * 8, 0);
        const fileSize = headerSize + trackDataSize;
        
        // Create buffer and write data
        const buffer = new ArrayBuffer(fileSize);
        const view = new DataView(buffer);
        let offset = 0;
        
        // Write header
        offset = this.writeHeader(view, offset, settings);
        
        // Write instruments
        offset = this.writeInstruments(view, offset, tracks);
        
        // Write tracks
        tracks.forEach(track => {
            offset = this.writeTrack(view, offset, track);
        });
        
        return buffer;
    }

    /**
     * Write ORG header
     */
    static writeHeader(view, offset, settings) {
        const encoder = new TextEncoder();
        const signature = encoder.encode(ORG_FILE_SIGNATURE);
        
        // Write signature
        for (let i = 0; i < 6; i++) {
            view.setUint8(offset + i, signature[i]);
        }
        
        // Write tempo and time signature
        view.setUint16(offset + 6, settings.tempo || 120, true);
        view.setUint8(offset + 8, settings.stepsPerBar || 4);
        view.setUint8(offset + 9, settings.beatsPerStep || 4);
        
        // Write loop points
        view.setUint32(offset + 10, settings.loopStart || 0, true);
        view.setUint32(offset + 14, settings.loopEnd || 0, true);
        
        return offset + 18;
    }

    /**
     * Write instrument data
     */
    static writeInstruments(view, offset, tracks) {
        tracks.forEach((track, i) => {
            view.setUint16(offset + i * 6, 1000, true); // Default pitch
            view.setUint8(offset + i * 6 + 2, track.instrumentNum);
            view.setUint8(offset + i * 6 + 3, 0); // pipi flag
            view.setUint16(offset + i * 6 + 4, track.notes.length, true);
        });
        
        return offset + 16 * 6;
    }

    /**
     * Write track data
     */
    static writeTrack(view, offset, track) {
        const noteCount = track.notes.length;
        
        // Write note count
        view.setUint32(offset, noteCount, true);
        offset += 4;
        
        // Write note data in separate arrays
        track.notes.forEach((note, i) => {
            view.setUint32(offset + i * 4, note.position, true);
            view.setUint8(offset + noteCount * 4 + i, note.key);
            view.setUint8(offset + noteCount * 5 + i, note.length);
            view.setUint8(offset + noteCount * 6 + i, note.volume);
            view.setUint8(offset + noteCount * 7 + i, note.pan);
        });
        
        return offset + noteCount * 8;
    }

    /**
     * Convert 72edo key to ORG key
     */
    static convert72edoToOrgKey(key72) {
        // Get nearest semitone
        const semitone = Math.round(key72 / NOTES_PER_SEMITONE);
        return Math.min(ORG_MAX_KEY, Math.max(0, semitone));
    }

    /**
     * Get instrument number from name
     */
    static getInstrumentNumber(instrumentName) {
        const match = instrumentName.match(/ORG_[MD](\d+)/);
        return match ? parseInt(match[1]) : 0;
    }
}