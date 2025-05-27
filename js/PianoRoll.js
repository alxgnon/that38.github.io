import { 
    PIANO_KEY_WIDTH, 
    NOTE_HEIGHT, 
    GRID_WIDTH, 
    NUM_OCTAVES, 
    NOTES_PER_OCTAVE,
    TOTAL_MEASURES,
    BEATS_PER_MEASURE,
    GRID_SUBDIVISIONS,
    DEFAULT_BPM,
    DEFAULT_VELOCITY,
    INSTRUMENT_COLOR_PALETTE
} from './constants.js';

import { AudioEngine } from './AudioEngine.js';
import { NoteManager } from './NoteManager.js';
import { InputHandler } from './InputHandler.js';
import { Renderer } from './Renderer.js';
import { OrgParser } from './OrgParser.js';

/**
 * Main PianoRoll class - coordinates all components
 */
export class PianoRoll {
    constructor(canvas) {
        this.canvas = canvas;
        
        // Initialize components
        this.audioEngine = new AudioEngine();
        this.noteManager = new NoteManager();
        this.inputHandler = new InputHandler(this);
        this.renderer = new Renderer(canvas, this);
        
        // Dimensions
        this.pianoKeyWidth = PIANO_KEY_WIDTH;
        this.noteHeight = NOTE_HEIGHT;
        this.gridWidth = GRID_WIDTH;
        this.numOctaves = NUM_OCTAVES;
        this.notesPerOctave = NOTES_PER_OCTAVE;
        this.numKeys = this.numOctaves * this.notesPerOctave;
        this.totalMeasures = TOTAL_MEASURES;
        this.beatsPerMeasure = BEATS_PER_MEASURE;
        this.totalWidth = this.pianoKeyWidth + (this.totalMeasures * this.beatsPerMeasure * this.gridWidth);
        this.totalHeight = this.numKeys * this.noteHeight;
        
        // State
        this.scrollX = 0;
        this.scrollY = 0;
        this.isPlaying = false;
        this.isPaused = false;
        this.currentMeasure = 0;
        this.gridSnap = true;
        this.currentVelocity = DEFAULT_VELOCITY;
        this.currentSample = 'ORG_M00';
        this.hoveredRow = -1;
        
        // Tempo settings
        this.currentBPM = DEFAULT_BPM;
        this.beatDuration = 60000 / this.currentBPM; // ms per beat
        this.measureDuration = this.beatDuration * this.beatsPerMeasure;
        
        // Loop state
        this.loopEnabled = false;
        this.loopStart = 0;
        this.loopEnd = 4;
        
        // Store org file track info when loaded
        this.orgTrackInfo = null;
        
        // Performance
        this.dirty = false; // Don't render until something changes
        this.showFPS = true;
        this.followMode = true;
        
        // Playback
        this.playingNotes = new Map();
        this.scheduledNotes = [];
        this.playbackStartTime = 0;
        this.playbackStartMeasure = 0;
        this.lastScheduledEndTime = 0;
        this.lastScheduledMeasure = 0;
        this.scheduleTimeout = null;
        
        // Instrument colors
        this.instrumentColors = new Map();
        this.instrumentColorIndex = 0;
        
        this.init();
    }

    async init() {
        this.resize();
        await this.audioEngine.loadWavetable();
        await this.initializeSamples();
        this.dirty = true; // Trigger initial draw
        
        // Emit initial scroll position
        this.emit('scroll', { scrollX: this.scrollX, scrollY: this.scrollY });
        
        this.animate();
    }

    async initializeSamples() {
        const { drumSamples, melodicSamples } = await this.audioEngine.getSampleList();
        
        // Update the select element
        const select = document.getElementById('waveformSelect');
        select.innerHTML = '';
        
        // Add drum samples group
        const drumGroup = document.createElement('optgroup');
        drumGroup.label = 'Drums (Pitched One-shots)';
        drumSamples.forEach(sample => {
            const option = document.createElement('option');
            option.value = sample;
            option.textContent = sample.replace('ORG_', '');
            drumGroup.appendChild(option);
        });
        select.appendChild(drumGroup);
        
        // Add melodic samples group
        const melodicGroup = document.createElement('optgroup');
        melodicGroup.label = 'Melodic (Looped Waveforms)';
        melodicSamples.forEach(sample => {
            const option = document.createElement('option');
            option.value = sample;
            option.textContent = sample.replace('ORG_', '');
            melodicGroup.appendChild(option);
        });
        select.appendChild(melodicGroup);
        
        // Load the default sample
        await this.audioEngine.loadSample(this.currentSample);
        select.value = this.currentSample;
        
        // Update color indicator
        this.updateInstrumentColorIndicator();
    }

    resize() {
        this.renderer.resize();
        this.dirty = true;
    }

    animate() {
        requestAnimationFrame(() => this.animate());
        
        if (this.isPlaying && !this.isPaused) {
            this.updatePlayback();
        }
        
        if (this.dirty) {
            this.renderer.draw();
            this.dirty = false;
        }
    }

    updatePlayback() {
        const currentTime = this.audioEngine.audioContext.currentTime;
        const elapsedTime = currentTime - this.playbackStartTime;
        const measuresElapsed = Math.floor(elapsedTime / (this.measureDuration / 1000));
        
        // Update current measure for display
        let newMeasure = this.playbackStartMeasure + measuresElapsed;
        
        // Handle looping
        if (this.loopEnabled && newMeasure >= this.loopEnd) {
            const loopLength = this.loopEnd - this.loopStart;
            newMeasure = this.loopStart + ((newMeasure - this.loopStart) % loopLength);
        }
        
        if (newMeasure !== this.currentMeasure) {
            this.currentMeasure = newMeasure;
            
            // Snap to current measure in follow mode
            if (this.followMode) {
                this.scrollToMeasure();
            }
        }
        
        this.dirty = true;
        
        // Emit playback update for pan/velocity bars
        this.emit('playbackUpdate', { currentMeasure: this.currentMeasure });
    }

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
        
        // Schedule notes until we've covered the lookahead time
        while (scheduleTime < scheduleUntilTime) {
            // Handle looping
            let displayMeasure = scheduleMeasure;
            if (this.loopEnabled && displayMeasure >= this.loopEnd) {
                const loopLength = this.loopEnd - this.loopStart;
                displayMeasure = this.loopStart + ((displayMeasure - this.loopStart) % loopLength);
            }
            
            // Get notes for this measure
            const measureStartX = this.pianoKeyWidth + displayMeasure * this.gridWidth * this.beatsPerMeasure;
            const measureWidth = this.gridWidth * this.beatsPerMeasure;
            const notesInMeasure = this.noteManager.getNotesInMeasures(displayMeasure, displayMeasure + 1);
            
            for (const note of notesInMeasure) {
                // Check if note actually starts within this measure's boundaries
                if (note.x >= measureStartX && note.x < measureStartX + measureWidth) {
                    const noteOffsetX = note.x - measureStartX;
                    const noteOffsetTime = (noteOffsetX / measureWidth) * (this.measureDuration / 1000);
                    const noteStartTime = scheduleTime + noteOffsetTime;
                    const noteDuration = (note.width / measureWidth) * (this.measureDuration / 1000);
                    
                    
                    if (noteStartTime >= currentTime) {
                        // Don't await - schedule all notes immediately
                        this.scheduleNoteAtTime(note, noteStartTime, noteDuration);
                    }
                }
            }
            
            // Move to next measure
            scheduleTime += this.measureDuration / 1000;
            scheduleMeasure++;
        }
        
        // Remember where we ended
        this.lastScheduledEndTime = scheduleTime;
        this.lastScheduledMeasure = scheduleMeasure;
        
        // Clean up old scheduled notes
        const cleanupTime = this.audioEngine.audioContext.currentTime;
        this.scheduledNotes = this.scheduledNotes.filter(s => s.stopTime > cleanupTime);
        
        // Schedule next update
        if (this.scheduleTimeout) {
            clearTimeout(this.scheduleTimeout);
        }
        this.scheduleTimeout = setTimeout(() => {
            if (this.isPlaying) {
                this.scheduleNotes();
            }
        }, 50); // Check every 50ms
    }

    scheduleNoteAtTime(note, startTime, duration) {
        // Calculate tick duration for automation timing
        // Use the actual ms per tick from the org file if available
        const tickDuration = this.orgMsPerTick ? this.orgMsPerTick / 1000 : this.beatDuration / 48000; // Convert to seconds
        
        // Use Web Audio API scheduling for accurate timing
        this.audioEngine.playNote(
            note.key,
            note.velocity,
            note.instrument,
            false,
            note.pan,
            startTime,
            duration,
            note.pipi || false,
            note.volumeAutomation || null,
            note.panAutomation || null,
            note.freqAdjust || 0,
            tickDuration
        ).then(noteData => {
            if (noteData) {
                const noteId = `${note.key}-${startTime}`;
                this.scheduledNotes.push({
                    id: noteId,
                    noteData: noteData,
                    stopTime: startTime + duration
                });
            }
        });
    }

    play() {
        if (!this.isPlaying) {
            this.isPlaying = true;
            
            if (!this.isPaused) {
                // Starting fresh - always start from beginning
                this.currentMeasure = 0;
                this.lastScheduledEndTime = 0;
                this.lastScheduledMeasure = 0;
                
                // Update scroll position if in follow mode
                if (this.followMode) {
                    this.scrollToMeasure();
                }
            }
            
            this.isPaused = false;
            this.scheduleNotes();
        }
    }

    pause() {
        if (this.isPlaying) {
            this.isPaused = true;
            this.isPlaying = false;
            
            // Cancel scheduling
            if (this.scheduleTimeout) {
                clearTimeout(this.scheduleTimeout);
                this.scheduleTimeout = null;
            }
            
            this.stopAllPlayingNotes();
        }
    }

    stop() {
        this.isPlaying = false;
        this.isPaused = false;
        this.currentMeasure = 0;
        this.lastScheduledEndTime = 0;
        this.lastScheduledMeasure = 0;
        
        // Cancel scheduling
        if (this.scheduleTimeout) {
            clearTimeout(this.scheduleTimeout);
            this.scheduleTimeout = null;
        }
        
        this.stopAllPlayingNotes();
        this.dirty = true;
    }

    stopAllPlayingNotes() {
        for (const [note, key] of this.playingNotes) {
            this.audioEngine.stopNote(key);
        }
        this.playingNotes.clear();
        this.scheduledNotes = [];
    }

    setTempo(bpm) {
        this.currentBPM = bpm;
        this.beatDuration = 60000 / bpm;
        this.measureDuration = this.beatDuration * this.beatsPerMeasure;
        this.audioEngine.setBPM(bpm);
    }

    setLoop(enabled, start = null, end = null) {
        this.loopEnabled = enabled;
        if (start !== null) this.loopStart = start;
        if (end !== null) this.loopEnd = end;
        this.renderer.markFullRedraw();
    }

    snapXToGrid(x) {
        if (!this.gridSnap) return x - this.pianoKeyWidth;
        const subdivisionWidth = this.gridWidth / GRID_SUBDIVISIONS;
        return Math.floor((x - this.pianoKeyWidth) / subdivisionWidth) * subdivisionWidth;
    }

    getInstrumentColor(instrumentName) {
        if (!this.instrumentColors.has(instrumentName)) {
            const color = INSTRUMENT_COLOR_PALETTE[
                this.instrumentColorIndex % INSTRUMENT_COLOR_PALETTE.length
            ];
            this.instrumentColors.set(instrumentName, color);
            this.instrumentColorIndex++;
        }
        return this.instrumentColors.get(instrumentName);
    }

    updateInstrumentColorIndicator() {
        const indicator = document.getElementById('instrumentColorIndicator');
        if (indicator) {
            const color = this.getInstrumentColor(this.currentSample);
            indicator.style.backgroundColor = color.note;
            indicator.style.borderColor = color.border;
        }
    }

    scrollToMeasure() {
        if (!this.isPlaying) return;
        
        // Keep the current measure at the left edge of the view
        const measureWidth = this.beatsPerMeasure * this.gridWidth;
        const measureStartX = this.pianoKeyWidth + this.currentMeasure * measureWidth;
        
        // Target scroll position: current measure should be at left edge (after piano keys)
        const targetScrollX = Math.max(0, measureStartX - this.pianoKeyWidth);
        
        // Snap immediately to target position
        if (this.scrollX !== targetScrollX) {
            this.scrollX = targetScrollX;
            this.emit('scroll', { scrollX: this.scrollX, scrollY: this.scrollY });
        }
    }

    async loadOrgFile(arrayBuffer) {
        try {
            const orgData = OrgParser.parse(arrayBuffer);
            const converted = OrgParser.convertToNotes(orgData, this.currentBPM);
            
            // Clear existing notes
            this.noteManager.clearAll();
            
            // Store org-specific timing info
            this.orgMsPerTick = converted.msPerTick;
            
            // Add converted notes
            converted.notes.forEach(noteData => {
                this.noteManager.createNote(noteData);
            });
            
            // Set tempo and loop
            this.setTempo(converted.tempo);
            this.setLoop(converted.loopEnabled, converted.loopStart, converted.loopEnd);
            
            // Store track info for display
            if (converted.trackInfo) {
                this.orgTrackInfo = converted.trackInfo;
                this.showOrgTrackInfo();
            }
            
            // Update UI
            document.getElementById('loopBtn').classList.toggle('active', converted.loopEnabled);
            document.getElementById('loopStartInput').value = converted.loopStart + 1;
            document.getElementById('loopEndInput').value = converted.loopEnd + 1;
            
            this.dirty = true;
            
            // Notify that notes have changed so pan/velocity bars update
            this.emit('notesChanged');
            
            return true;
        } catch (error) {
            throw error;
        }
    }
    
    // Serialization methods
    // Show org track info in console or modal
    showOrgTrackInfo() {
        if (!this.orgTrackInfo) return;
        
    }
    
    exportToJSON() {
        const beatWidth = GRID_WIDTH / GRID_SUBDIVISIONS;
        const measureWidth = GRID_WIDTH * BEATS_PER_MEASURE;
        
        const songData = {
            version: '1.1',
            name: 'Untitled',
            tempo: this.currentBPM,
            timeSignature: `${BEATS_PER_MEASURE}/4`,
            loop: {
                enabled: this.loopEnabled,
                startMeasure: this.loopStart,
                endMeasure: this.loopEnd
            },
            notes: this.noteManager.notes.map(note => {
                // Convert x position to measure and beat
                const totalBeats = (note.x - PIANO_KEY_WIDTH) / beatWidth;
                const measure = Math.floor(totalBeats / (BEATS_PER_MEASURE * GRID_SUBDIVISIONS));
                const beatInMeasure = totalBeats % (BEATS_PER_MEASURE * GRID_SUBDIVISIONS);
                
                // Convert width to duration in beats
                const duration = note.width / beatWidth;
                
                return {
                    pitch: note.key,
                    measure: measure,
                    beat: beatInMeasure,
                    duration: duration,
                    velocity: note.velocity,
                    pan: note.pan,
                    instrument: note.instrument,
                    volumeAutomation: note.volumeAutomation || null,
                    panAutomation: note.panAutomation || null
                };
            })
        };
        
        return JSON.stringify(songData, null, 2);
    }
    
    importFromJSON(jsonString) {
        try {
            const songData = JSON.parse(jsonString);
            
            // Clear existing notes and org info
            this.noteManager.clearAll();
            this.orgTrackInfo = null;
            
            // Set tempo
            if (songData.tempo) {
                this.setTempo(songData.tempo);
            }
            
            // Set loop settings
            if (songData.loop) {
                // Handle both old and new format
                const loopStart = songData.loop.startMeasure !== undefined ? 
                    songData.loop.startMeasure : songData.loop.start;
                const loopEnd = songData.loop.endMeasure !== undefined ? 
                    songData.loop.endMeasure : songData.loop.end;
                    
                this.setLoop(
                    songData.loop.enabled,
                    loopStart,
                    loopEnd
                );
            }
            
            // Import notes
            if (songData.notes && Array.isArray(songData.notes)) {
                const beatWidth = GRID_WIDTH / GRID_SUBDIVISIONS;
                const measureWidth = GRID_WIDTH * BEATS_PER_MEASURE;
                
                songData.notes.forEach(noteData => {
                    // Handle new format (measure/beat/duration)
                    if (noteData.measure !== undefined) {
                        const x = PIANO_KEY_WIDTH + (noteData.measure * measureWidth) + (noteData.beat * beatWidth);
                        const y = (NUM_OCTAVES * NOTES_PER_OCTAVE - 1 - noteData.pitch) * NOTE_HEIGHT;
                        const width = noteData.duration * beatWidth;
                        
                        this.noteManager.createNote({
                            x: x,
                            y: y,
                            width: width,
                            height: NOTE_HEIGHT,
                            key: noteData.pitch,
                            velocity: noteData.velocity || DEFAULT_VELOCITY,
                            pan: noteData.pan || 0,
                            instrument: noteData.instrument || 'M00',
                            volumeAutomation: noteData.volumeAutomation || null,
                            panAutomation: noteData.panAutomation || null
                        });
                    } else {
                        // Handle old format (x/y/width/height) for backwards compatibility
                        this.noteManager.createNote(noteData);
                    }
                });
            }
            
            // Update UI
            document.getElementById('loopBtn').classList.toggle('active', this.loopEnabled);
            document.getElementById('loopStartInput').value = this.loopStart + 1;
            document.getElementById('loopEndInput').value = this.loopEnd + 1;
            
            this.dirty = true;
            this.renderer.markFullRedraw();
            this.emit('notesChanged');
            
            return true;
        } catch (error) {
            throw new Error('Invalid song file format');
        }
    }
    
    // Event system
    addEventListener(event, callback) {
        if (!this.listeners) {
            this.listeners = {};
        }
        if (!this.listeners[event]) {
            this.listeners[event] = [];
        }
        this.listeners[event].push(callback);
    }
    
    removeEventListener(event, callback) {
        if (!this.listeners || !this.listeners[event]) return;
        const index = this.listeners[event].indexOf(callback);
        if (index > -1) {
            this.listeners[event].splice(index, 1);
        }
    }
    
    emit(event, data) {
        if (!this.listeners || !this.listeners[event]) return;
        this.listeners[event].forEach(callback => callback(data));
    }
}