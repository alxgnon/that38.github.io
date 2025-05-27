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
import { MidiParser } from './MidiParser.js';
import PlaybackEngine from './PlaybackEngine.js';

/**
 * Main PianoRoll class - coordinates all components
 */
export class PianoRoll {
    constructor(canvas) {
        this.canvas = canvas;
        
        // Initialize components
        this.noteManager = new NoteManager();
        
        // Initialize playback engine
        this.playbackEngine = new PlaybackEngine({
            wavetablePath: 'wavetable.bin',  // Use the correct path
            onNoteStart: (note) => this.onNoteStart(note),
            onNoteEnd: (note) => this.onNoteEnd(note),
            onMeasureChange: (measure) => this.onMeasureChange(measure),
            onStop: () => this.onPlaybackStop()
        });
        
        // For backward compatibility
        this.audioEngine = this.playbackEngine.getAudioEngine();
        
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
        
        // Playback UI state
        this.playingNotes = new Map();
        
        // Instrument colors
        this.instrumentColors = new Map();
        this.instrumentColorIndex = 0;
        
        // Track visibility - delegate to playback engine
        Object.defineProperty(this, 'trackVisibility', {
            get: () => this.playbackEngine.trackVisibility,
            set: (val) => { this.playbackEngine.trackVisibility = val; }
        });
        
        this.init();
    }

    async init() {
        this.resize();
        await this.playbackEngine.init();
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
        // Playback state is now managed by PlaybackEngine through callbacks
        // This method is kept for compatibility but does nothing
    }

    // Note scheduling is now handled by PlaybackEngine
    /*
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
                // Skip if track is hidden
                if (this.trackVisibility.get(note.instrument) === false) {
                    continue;
                }
                
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
    */

    /*
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
    */

    play() {
        if (!this.isPlaying) {
            this.isPlaying = true;
            
            if (!this.isPaused) {
                // Starting fresh - always start from beginning
                this.currentMeasure = 0;
                
                // Update scroll position if in follow mode
                if (this.followMode) {
                    this.scrollToMeasure();
                }
            }
            
            this.isPaused = false;
            
            // Update playback engine with current notes and settings
            this.playbackEngine.loadNotes(this.noteManager.notes, this.orgMsPerTick);
            this.playbackEngine.setTempo(this.currentBPM);
            this.playbackEngine.setLoop(this.loopEnabled, this.loopStart, this.loopEnd);
            this.playbackEngine.play(this.currentMeasure);
        }
    }

    pause() {
        if (this.isPlaying) {
            this.isPaused = true;
            this.isPlaying = false;
            
            this.playbackEngine.pause();
            this.stopAllPlayingNotes();
        }
    }

    stop() {
        this.isPlaying = false;
        this.isPaused = false;
        this.currentMeasure = 0;
        
        this.playbackEngine.stop();
        
        // Return to start
        this.scrollX = 0;
        this.emit('scroll', { scrollX: this.scrollX, scrollY: this.scrollY });
        this.dirty = true;
    }

    stopAllPlayingNotes() {
        // Clear visual indicators
        this.playingNotes.clear();
        this.dirty = true;
    }

    setTempo(bpm) {
        this.currentBPM = bpm;
        this.beatDuration = 60000 / bpm;
        this.measureDuration = this.beatDuration * this.beatsPerMeasure;
        this.playbackEngine.setTempo(bpm);
    }

    setLoop(enabled, start = null, end = null) {
        this.loopEnabled = enabled;
        if (start !== null) this.loopStart = start;
        if (end !== null) this.loopEnd = end;
        this.playbackEngine.setLoop(enabled, start, end);
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
            
            // Clear instrument colors to ensure consistent assignment
            this.instrumentColors.clear();
            this.instrumentColorIndex = 0;
            
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
    
    async loadMidiFile(arrayBuffer) {
        try {
            const midiData = MidiParser.parse(arrayBuffer);
            const converted = MidiParser.convertToNotes(midiData, arrayBuffer);
            
            // Clear existing notes
            this.noteManager.clearAll();
            
            // Clear instrument colors to ensure consistent assignment
            this.instrumentColors.clear();
            this.instrumentColorIndex = 0;
            
            // Add converted notes
            converted.notes.forEach(noteData => {
                this.noteManager.createNote(noteData);
            });
            
            // Set tempo and loop
            this.setTempo(converted.tempo);
            this.setLoop(converted.loopEnabled, converted.loopStart, converted.loopEnd);
            
            // Update UI
            document.getElementById('loopBtn').classList.toggle('active', converted.loopEnabled);
            document.getElementById('loopStartInput').value = converted.loopStart + 1;
            document.getElementById('loopEndInput').value = converted.loopEnd + 1;
            
            this.dirty = true;
            this.renderer.markFullRedraw();
            
            // Notify that notes have changed so pan/velocity bars update
            this.emit('notesChanged');
            
            // Show track info
            this.showMidiTrackInfo();
            
            return true;
        } catch (error) {
            throw error;
        }
    }
    
    // Show org track info in console or modal
    showOrgTrackInfo() {
        if (!this.orgTrackInfo) return;
        
        // Build track info from notes
        const trackData = this.buildTrackData();
        this.showTrackInfoModal(trackData);
    }
    
    showMidiTrackInfo() {
        // Build track info from notes
        const trackData = this.buildTrackData();
        this.showTrackInfoModal(trackData);
    }
    
    buildTrackData() {
        const tracks = new Map();
        
        // Collect all notes by instrument
        this.noteManager.notes.forEach(note => {
            if (!tracks.has(note.instrument)) {
                const color = this.getInstrumentColor(note.instrument);
                // Check if we have a visibility state, default to true
                const visible = this.trackVisibility.get(note.instrument) !== false;
                tracks.set(note.instrument, {
                    name: note.instrument,
                    notes: [],
                    color: color,
                    visible: visible,
                    solo: false,
                    muted: false
                });
            }
            tracks.get(note.instrument).notes.push(note);
        });
        
        // Convert to array and sort by name
        return Array.from(tracks.values()).sort((a, b) => {
            // Put numbered tracks first, then alphabetical
            const aNum = parseInt(a.name.match(/\d+/)?.[0]);
            const bNum = parseInt(b.name.match(/\d+/)?.[0]);
            
            if (!isNaN(aNum) && !isNaN(bNum)) {
                return aNum - bNum;
            } else if (!isNaN(aNum)) {
                return -1;
            } else if (!isNaN(bNum)) {
                return 1;
            }
            
            return a.name.localeCompare(b.name);
        });
    }
    
    showTrackInfoModal(trackData) {
        const content = document.getElementById('trackInfoContent');
        if (!content) return;
        
        content.innerHTML = '';
        
        if (trackData.length === 0) {
            content.innerHTML = '<p style="text-align: center; color: #999;">No tracks found</p>';
        } else {
            trackData.forEach((track, index) => {
                const trackEl = document.createElement('div');
                trackEl.className = 'track-item';
                trackEl.innerHTML = `
                    <div class="track-color" style="background-color: ${track.color.note}; border-color: ${track.color.border}"></div>
                    <div class="track-details">
                        <div class="track-name">${track.name}</div>
                        <div class="track-stats">${track.notes.length} notes</div>
                    </div>
                    <div class="track-controls">
                        <button class="track-btn track-visibility ${track.visible ? 'active' : ''}" data-track="${track.name}" title="Toggle visibility">
                            ${track.visible ? '👁' : '🚫'}
                        </button>
                    </div>
                `;
                content.appendChild(trackEl);
            });
            
            // Add event listeners
            content.querySelectorAll('.track-visibility').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const trackName = e.target.getAttribute('data-track');
                    this.toggleTrackVisibility(trackName);
                    e.target.classList.toggle('active');
                    e.target.textContent = e.target.classList.contains('active') ? '👁' : '🚫';
                });
            });
        }
        
        // Show modal using ModalManager
        if (window.modalManager) {
            window.modalManager.show('trackInfoModal');
        }
    }
    
    toggleTrackVisibility(trackName) {
        // Toggle visibility state
        const currentVisibility = this.trackVisibility.get(trackName);
        const newVisibility = currentVisibility === false ? true : false;
        this.playbackEngine.setTrackVisibility(trackName, newVisibility);
        
        // Update rendering
        this.renderer.markFullRedraw();
        this.dirty = true;
        
        // Also update pan/velocity bars
        this.emit('notesChanged');
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
                    pipi: note.pipi || 0,
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
                            pipi: noteData.pipi || 0,
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
    
    // Playback Engine Callbacks
    onNoteStart(note) {
        this.playingNotes.set(note, true);
        this.dirty = true;
    }
    
    onNoteEnd(note) {
        this.playingNotes.delete(note);
        this.dirty = true;
    }
    
    onMeasureChange(measure) {
        this.currentMeasure = measure;
        
        // Snap to current measure in follow mode
        if (this.followMode) {
            this.scrollToMeasure();
        }
        
        this.dirty = true;
        this.emit('playbackUpdate', { currentMeasure: this.currentMeasure });
    }
    
    onPlaybackStop() {
        this.isPlaying = false;
        this.isPaused = false;
        this.playingNotes.clear();
        this.dirty = true;
    }
    
    emit(event, data) {
        if (!this.listeners || !this.listeners[event]) return;
        this.listeners[event].forEach(callback => callback(data));
    }
    
    /**
     * Play a piano key (for MIDI input)
     */
    playPianoKey(keyNumber, velocity = 100) {
        // Use a unique ID for tracking this preview note
        const noteId = `preview_${keyNumber}_${Date.now()}`;
        const playedNote = this.audioEngine.playNote(keyNumber, velocity, this.currentSample, false);
        
        // Track the preview note
        if (!this.previewNotes) {
            this.previewNotes = new Map();
        }
        this.previewNotes.set(keyNumber, { noteId: playedNote, startTime: Date.now() });
        
        return playedNote;
    }
    
    /**
     * Stop a piano key (for MIDI input)
     */
    stopPianoKey(keyNumber) {
        if (!this.previewNotes || !this.previewNotes.has(keyNumber)) return;
        
        const previewNote = this.previewNotes.get(keyNumber);
        if (previewNote) {
            // Stop the note by clearing it from active notes
            this.audioEngine.stopNote(keyNumber);
            this.previewNotes.delete(keyNumber);
        }
    }
}