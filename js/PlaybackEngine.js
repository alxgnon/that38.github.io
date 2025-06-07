/**
 * Standalone playback engine for that72.org JSON songs
 * Can be used independently of the editor UI
 */

import { AudioEngine } from './AudioEngine.js';
import { 
    GRID_WIDTH,
    BEATS_PER_MEASURE,
    GRID_SUBDIVISIONS,
    NOTE_HEIGHT,
    NOTES_PER_OCTAVE,
    NUM_OCTAVES,
    PIANO_KEY_WIDTH
} from './constants.js';

export class PlaybackEngine {
    constructor(options = {}) {
        // Configuration
        this.wavetablePath = options.wavetablePath || './wavetable.bin';
        this.onNoteStart = options.onNoteStart || null;
        this.onNoteEnd = options.onNoteEnd || null;
        this.onMeasureChange = options.onMeasureChange || null;
        this.onStop = options.onStop || null;
        
        // Audio engine
        this.audioEngine = new AudioEngine();
        
        // Playback state
        this.isPlaying = false;
        this.currentMeasure = 0;
        this.currentBPM = 120;
        this.loopEnabled = false;
        this.loopStart = 0;
        this.loopEnd = 5;
        
        // Song data
        this.songData = null;
        this.notes = [];
        this.orgMsPerTick = null;
        
        // Scheduling
        this.scheduledNotes = [];
        this.playbackStartTime = 0;
        this.playbackStartMeasure = 0;
        this.lastScheduledEndTime = 0;
        this.lastScheduledMeasure = 0;
        this.scheduleTimeout = null;
        
        // Track visibility (all visible by default)
        this.trackVisibility = new Map();
        
        // Song length calculation
        this.calculatedSongLength = 256; // Default to full length until calculated
    }
    
    /**
     * Initialize the engine (load wavetable)
     */
    async init() {
        await this.audioEngine.loadWavetable();
        // AudioEngine doesn't need sample initialization - it loads samples on demand
    }
    
    /**
     * Load a song from JSON
     * @param {Object|string} songData - Song object or JSON string
     */
    loadSong(songData) {
        if (typeof songData === 'string') {
            songData = JSON.parse(songData);
        }
        
        this.songData = songData;
        this.notes = [];
        
        // Set tempo and loop settings
        this.currentBPM = songData.tempo || 120;
        this.loopEnabled = songData.loop?.enabled || false;
        this.loopStart = songData.loop?.startMeasure || 0;
        this.loopEnd = songData.loop?.endMeasure || 5;
        
        // Convert notes from storage format
        const beatWidth = GRID_WIDTH / GRID_SUBDIVISIONS;
        
        songData.notes.forEach(noteData => {
            const x = PIANO_KEY_WIDTH + (noteData.measure * BEATS_PER_MEASURE * GRID_SUBDIVISIONS + noteData.beat) * beatWidth;
            const width = noteData.duration * beatWidth;
            const y = (NUM_OCTAVES * NOTES_PER_OCTAVE - 1 - noteData.pitch) * NOTE_HEIGHT;
            
            this.notes.push({
                x,
                y,
                width,
                height: NOTE_HEIGHT,
                key: noteData.pitch,
                velocity: noteData.velocity || 100,
                pan: noteData.pan || 0,
                instrument: noteData.instrument || 'ORG_M00',
                pipi: noteData.pipi || false,
                volumeAutomation: noteData.volumeAutomation || [],
                panAutomation: noteData.panAutomation || []
            });
        });
        
        // Update audio engine BPM
        this.audioEngine.setBPM(this.currentBPM);
        
        // Reset track visibility
        this.trackVisibility.clear();
        
        // Calculate song length
        this.calculateSongLength();
    }
    
    /**
     * Load notes directly (for editor integration)
     * @param {Array} notes - Array of note objects in editor format
     * @param {number} orgMsPerTick - Optional ms per tick for ORG files
     */
    loadNotes(notes, orgMsPerTick = null) {
        this.notes = notes;
        this.orgMsPerTick = orgMsPerTick;
        // Don't clear track visibility when loading notes directly
        
        // Calculate the actual song length
        this.calculateSongLength();
    }
    
    /**
     * Calculate the actual length of the song based on notes
     */
    calculateSongLength() {
        if (!this.notes || this.notes.length === 0) {
            this.calculatedSongLength = 10; // Play at least 10 measures even if empty
            return;
        }
        
        let maxEndX = 0;
        for (const note of this.notes) {
            const noteEndX = note.x + note.width;
            if (noteEndX > maxEndX) {
                maxEndX = noteEndX;
            }
        }
        
        // Convert X position to measure number
        const measureWidth = GRID_WIDTH * BEATS_PER_MEASURE;
        this.calculatedSongLength = Math.max(10, Math.ceil((maxEndX - PIANO_KEY_WIDTH) / measureWidth) + 1);
    }
    
    /**
     * Start playback
     * @param {number} fromMeasure - Optional starting measure
     */
    play(fromMeasure = null) {
        if (this.isPlaying) return;
        
        // Allow playback even with no notes
        if (!this.notes) {
            this.notes = [];
        }
        
        // Ensure we have a valid song length
        if (this.calculatedSongLength === 0) {
            this.calculateSongLength();
        }
        
        this.isPlaying = true;
        this.currentMeasure = fromMeasure !== null ? fromMeasure : this.currentMeasure;
        
        // Reset scheduling state
        this.scheduledNotes = [];
        this.lastScheduledEndTime = 0;
        this.lastScheduledMeasure = this.currentMeasure;
        
        this.scheduleNotes();
        this.updateLoop();
    }
    
    /**
     * Stop playback
     */
    stop() {
        if (!this.isPlaying) return;
        
        this.isPlaying = false;
        this.currentMeasure = 0;
        
        // Stop any currently playing notes immediately
        const currentTime = this.audioEngine.audioContext.currentTime;
        this.scheduledNotes.forEach(scheduled => {
            // Only try to stop notes that haven't ended yet
            if (scheduled.stopTime > currentTime && scheduled.note) {
                // Try to stop via the key number
                this.audioEngine.stopNote(scheduled.note.key);
            }
        });
        this.scheduledNotes = [];
        
        // Clear scheduling
        if (this.scheduleTimeout) {
            clearTimeout(this.scheduleTimeout);
            this.scheduleTimeout = null;
        }
        
        if (this.onStop) {
            this.onStop();
        }
    }
    
    /**
     * Pause playback
     */
    pause() {
        if (!this.isPlaying) return;
        
        this.isPlaying = false;
        
        // Stop scheduling but keep position
        if (this.scheduleTimeout) {
            clearTimeout(this.scheduleTimeout);
            this.scheduleTimeout = null;
        }
    }
    
    /**
     * Set tempo
     * @param {number} bpm - Beats per minute
     */
    setTempo(bpm) {
        this.currentBPM = bpm;
        this.audioEngine.setBPM(bpm);
    }
    
    /**
     * Set loop
     * @param {boolean} enabled - Whether loop is enabled
     * @param {number} start - Loop start measure
     * @param {number} end - Loop end measure
     */
    setLoop(enabled, start = null, end = null) {
        this.loopEnabled = enabled;
        if (start !== null) this.loopStart = start;
        if (end !== null) this.loopEnd = end;
    }
    
    /**
     * Set track mute state
     * @param {string} trackName - Instrument/track name
     * @param {boolean} muted - Whether track is muted
     */
    setTrackMute(trackName, muted) {
        this.trackVisibility.set(trackName, !muted);
    }
    
    /**
     * Get list of tracks in the song
     * @returns {Array} Array of track info objects
     */
    getTracks() {
        const tracks = new Map();
        
        this.notes.forEach(note => {
            if (!tracks.has(note.instrument)) {
                tracks.set(note.instrument, {
                    name: note.instrument,
                    noteCount: 0
                });
            }
            tracks.get(note.instrument).noteCount++;
        });
        
        return Array.from(tracks.values());
    }
    
    /**
     * Schedule notes for playback
     */
    scheduleNotes() {
        const currentTime = this.audioEngine.audioContext.currentTime;
        const lookAheadTime = 0.1; // 100ms lookahead
        const scheduleUntilTime = currentTime + lookAheadTime;
        
        
        // Initialize scheduling if needed
        if (this.lastScheduledEndTime === 0) {
            this.playbackStartTime = currentTime;
            this.playbackStartMeasure = this.currentMeasure;
            this.lastScheduledEndTime = currentTime;
            this.lastScheduledMeasure = this.currentMeasure;
        }
        
        let scheduleTime = this.lastScheduledEndTime;
        let scheduleMeasure = this.lastScheduledMeasure;
        
        const measureDuration = (60 / this.currentBPM) * BEATS_PER_MEASURE;
        
        // Schedule notes until we've covered the lookahead time
        let hasScheduledAnything = false;
        while (scheduleTime < scheduleUntilTime) {
            // Handle looping
            let displayMeasure = scheduleMeasure;
            if (this.loopEnabled && displayMeasure >= this.loopEnd) {
                const loopLength = this.loopEnd - this.loopStart;
                displayMeasure = this.loopStart + ((displayMeasure - this.loopStart) % loopLength);
            }
            
            // Don't stop during scheduling - let the song play out
            // The stop condition is now handled by checking if we have scheduled far enough ahead
            
            // Get notes for this measure
            const measureStartX = PIANO_KEY_WIDTH + displayMeasure * GRID_WIDTH * BEATS_PER_MEASURE;
            const measureWidth = GRID_WIDTH * BEATS_PER_MEASURE;
            const notesInMeasure = this.getNotesInMeasure(displayMeasure);
            
            for (const note of notesInMeasure) {
                // Skip if track is hidden
                if (this.trackVisibility.get(note.instrument) === false) {
                    continue;
                }
                
                // Check if note actually starts within this measure's boundaries
                if (note.x >= measureStartX && note.x < measureStartX + measureWidth) {
                    const noteOffsetX = note.x - measureStartX;
                    const noteOffsetTime = (noteOffsetX / measureWidth) * measureDuration;
                    const noteStartTime = scheduleTime + noteOffsetTime;
                    const noteDuration = (note.width / measureWidth) * measureDuration;
                    
                    if (noteStartTime >= currentTime) {
                        this.scheduleNoteAtTime(note, noteStartTime, noteDuration);
                    }
                }
            }
            
            // Move to next measure
            scheduleTime += measureDuration;
            scheduleMeasure++;
            hasScheduledAnything = true;
        }
        
        // Remember where we ended
        this.lastScheduledEndTime = scheduleTime;
        this.lastScheduledMeasure = scheduleMeasure;
        
        // Clean up old scheduled notes
        const cleanupTime = this.audioEngine.audioContext.currentTime;
        this.scheduledNotes = this.scheduledNotes.filter(s => s.stopTime > cleanupTime);
        
        // Schedule next batch
        if (this.isPlaying) {
            this.scheduleTimeout = setTimeout(() => this.scheduleNotes(), 50);
        }
    }
    
    /**
     * Schedule a single note
     */
    async scheduleNoteAtTime(note, startTime, duration) {
        // Calculate tick duration for automation timing
        // Use the actual ms per tick from the org file if available
        const beatDuration = 60 / this.currentBPM;
        const tickDuration = this.orgMsPerTick ? this.orgMsPerTick / 1000 : beatDuration / 48000; // Convert to seconds
        
        const noteId = await this.audioEngine.playNote(
            note.key,           // keyNumber
            note.velocity,       // velocity
            note.instrument,     // sampleName
            false,              // isGlissando
            note.pan,           // pan
            startTime,          // when
            duration,           // duration
            note.pipi,          // pipi
            note.volumeAutomation,  // volumeAutomation
            note.panAutomation,     // panAutomation
            note.freqAdjust || 0,   // freqAdjust
            tickDuration        // tickDuration
        );
        
        this.scheduledNotes.push({
            id: noteId,
            note: note,
            startTime: startTime,
            stopTime: startTime + duration
        });
        
        // Callback for visualization
        if (this.onNoteStart) {
            const delay = Math.max(0, (startTime - this.audioEngine.audioContext.currentTime) * 1000);
            setTimeout(() => {
                if (this.isPlaying) {
                    this.onNoteStart(note);
                }
            }, delay);
        }
        
        if (this.onNoteEnd) {
            const endDelay = Math.max(0, (startTime + duration - this.audioEngine.audioContext.currentTime) * 1000);
            setTimeout(() => {
                if (this.isPlaying) {
                    this.onNoteEnd(note);
                }
            }, endDelay);
        }
    }
    
    /**
     * Get notes in a specific measure
     */
    getNotesInMeasure(measure) {
        const measureStartX = PIANO_KEY_WIDTH + measure * GRID_WIDTH * BEATS_PER_MEASURE;
        const measureEndX = measureStartX + GRID_WIDTH * BEATS_PER_MEASURE;
        
        return this.notes.filter(note => {
            const noteEndX = note.x + note.width;
            return note.x < measureEndX && noteEndX > measureStartX;
        });
    }
    
    /**
     * Update loop - tracks current measure
     */
    updateLoop() {
        if (!this.isPlaying) return;
        
        const currentTime = this.audioEngine.audioContext.currentTime;
        const elapsedTime = currentTime - this.playbackStartTime;
        const measureDuration = (60 / this.currentBPM) * BEATS_PER_MEASURE;
        const elapsedMeasures = Math.floor(elapsedTime / measureDuration);
        
        let newMeasure = this.playbackStartMeasure + elapsedMeasures;
        
        // Handle looping
        if (this.loopEnabled && newMeasure >= this.loopEnd) {
            const loopLength = this.loopEnd - this.loopStart;
            newMeasure = this.loopStart + ((newMeasure - this.loopStart) % loopLength);
        }
        
        if (newMeasure !== this.currentMeasure) {
            this.currentMeasure = newMeasure;
            if (this.onMeasureChange) {
                this.onMeasureChange(this.currentMeasure);
            }
            
            // Stop if we've reached the end of the song (unless looping)
            if (!this.loopEnabled && this.currentMeasure >= this.calculatedSongLength) {
                this.stop();
                return;
            }
        }
        
        if (this.isPlaying) {
            requestAnimationFrame(() => this.updateLoop());
        }
    }
    
    /**
     * Get current playback position in seconds
     */
    getCurrentTime() {
        if (!this.isPlaying) return 0;
        return this.audioEngine.audioContext.currentTime - this.playbackStartTime;
    }
    
    /**
     * Get current volume (0-100)
     */
    getVolume() {
        return this.audioEngine.getVolume();
    }
    
    /**
     * Set volume (0-100)
     */
    setVolume(volume) {
        this.audioEngine.setVolume(volume);
    }
    
    /**
     * Get audio engine reference (for editor integration)
     */
    getAudioEngine() {
        return this.audioEngine;
    }
    
    /**
     * Get current BPM
     */
    getTempo() {
        return this.currentBPM;
    }
    
    /**
     * Check if playing
     */
    getIsPlaying() {
        return this.isPlaying;
    }
    
    /**
     * Get current measure
     */
    getCurrentMeasure() {
        return this.currentMeasure;
    }
}

// Export as default for convenience
export default PlaybackEngine;