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
        this.noteManager.pianoRoll = this;
        
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
        this.baseGridWidth = GRID_WIDTH;
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
        this.snapMode = 'normal'; // 'normal' or 'high-res'
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


    play(fromMeasure = null) {
        if (!this.isPlaying) {
            this.isPlaying = true;
            
            if (!this.isPaused || fromMeasure !== null) {
                // Starting fresh or from specific measure
                this.currentMeasure = fromMeasure !== null ? fromMeasure : 0;
                
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
    
    playFromCurrentPosition() {
        // Calculate the measure visible at the beginning (left edge) of the screen
        const measureWidth = GRID_WIDTH * BEATS_PER_MEASURE;
        const currentViewMeasure = Math.floor((this.scrollX) / measureWidth);
        const measureToPlay = Math.max(0, currentViewMeasure);
        
        // Stop if playing
        if (this.isPlaying) {
            this.stop();
        }
        
        // Play from the calculated measure
        this.play(measureToPlay);
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
        const snapDivisions = this.getSnapDivisions();
        const subdivisionWidth = this.gridWidth * this.beatsPerMeasure / snapDivisions;
        return Math.floor((x - this.pianoKeyWidth) / subdivisionWidth) * subdivisionWidth;
    }

    getInstrumentColor(instrumentName) {
        if (!this.instrumentColors.has(instrumentName)) {
            // Use a deterministic color based on instrument name
            // This ensures consistent colors regardless of load order
            let colorIndex;
            
            if (instrumentName.startsWith('ORG_M')) {
                // For melodic instruments, use the instrument number
                const num = parseInt(instrumentName.substring(5));
                colorIndex = num % INSTRUMENT_COLOR_PALETTE.length;
            } else if (instrumentName.startsWith('ORG_D')) {
                // For drums, offset by 100 to avoid conflicts with melodic
                const num = parseInt(instrumentName.substring(5));
                colorIndex = (100 + num) % INSTRUMENT_COLOR_PALETTE.length;
            } else {
                // For other instruments (MIDI etc), use string hash
                let hash = 0;
                for (let i = 0; i < instrumentName.length; i++) {
                    hash = ((hash << 5) - hash) + instrumentName.charCodeAt(i);
                    hash = hash & hash; // Convert to 32bit integer
                }
                colorIndex = Math.abs(hash) % INSTRUMENT_COLOR_PALETTE.length;
            }
            
            const color = INSTRUMENT_COLOR_PALETTE[colorIndex];
            this.instrumentColors.set(instrumentName, color);
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
            // Stop playback if playing
            if (this.isPlaying) {
                this.stop();
            }
            
            const orgData = OrgParser.parse(arrayBuffer);
            const converted = OrgParser.convertToNotes(orgData, this.currentBPM);
            
            // Clear existing notes
            this.noteManager.clearAll();
            
            // Clear instrument colors to ensure consistent assignment
            this.instrumentColors.clear();
            
            // Auto-detect if this is a high-resolution song (Kero Blaster)
            // Calculate total divisions per measure
            const divisionsPerMeasure = orgData.header.stepsPerBar * orgData.header.beatsPerStep;
            
            // Debug logging
            console.log(`ORG file: stepsPerBar=${orgData.header.stepsPerBar}, beatsPerStep=${orgData.header.beatsPerStep}, total=${divisionsPerMeasure}`);
            
            // High-res detection based on common patterns:
            // Cave Story typically uses: 4x4=16, 2x8=16, 8x2=16
            // Kero Blaster typically uses: 8x4=32, 4x8=32, etc.
            // Some Cave Story songs might use 8x4=32 but don't actually need fine mode
            // Better heuristic: only use fine mode for 32+ divisions AND if the file is from Kero Blaster
            const isHighRes = divisionsPerMeasure >= 32;
            
            if (isHighRes) {
                this.snapMode = 'high-res';
                this.gridWidth = this.baseGridWidth * 2;
                // Update UI
                const snapModeBtn = document.getElementById('snapModeBtn');
                if (snapModeBtn) {
                    snapModeBtn.classList.add('high-res');
                    snapModeBtn.querySelector('span').textContent = 'Snap: Fine';
                }
            } else {
                this.snapMode = 'normal';
                this.gridWidth = this.baseGridWidth;
                // Update UI
                const snapModeBtn = document.getElementById('snapModeBtn');
                if (snapModeBtn) {
                    snapModeBtn.classList.remove('high-res');
                    snapModeBtn.querySelector('span').textContent = 'Snap: Normal';
                }
            }
            
            // Recalculate total width
            this.totalWidth = this.pianoKeyWidth + (this.totalMeasures * this.beatsPerMeasure * this.gridWidth);
            
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
            
            // Update play button state
            if (typeof updatePlayButton === 'function') {
                updatePlayButton();
            }
            
            return true;
        } catch (error) {
            throw error;
        }
    }
    
    async loadMidiFile(arrayBuffer) {
        try {
            // Stop playback if playing
            if (this.isPlaying) {
                this.stop();
            }
            
            const midiData = MidiParser.parse(arrayBuffer);
            const converted = MidiParser.convertToNotes(midiData, arrayBuffer, -1, null);
            
            // Clear existing notes
            this.noteManager.clearAll();
            
            // Clear instrument colors to ensure consistent assignment
            this.instrumentColors.clear();
            
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
            
            // Update play button state
            if (typeof updatePlayButton === 'function') {
                updatePlayButton();
            }
            
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
                        <button class="track-btn track-mute ${!track.visible ? 'muted' : ''}" data-track="${track.name}" title="${track.visible ? 'Mute track' : 'Unmute track'}">
                            ${track.visible ? 
                                '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M3 5v6h3l4 4V1L6 5H3zm10.5 3c0-1.77-1-3.29-2.5-4.03v8.06c1.5-.74 2.5-2.26 2.5-4.03z"/></svg>' : 
                                '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M3 5v6h3l4 4V1L6 5H3zm10.85 3L12 5.15v1.7L10.15 5l-.85.85L11.15 8 9.3 10.15l.85.85L12 9.15v1.7L13.85 10l.85-.85L12.85 8l1.85-1.85-.85-.85z"/></svg>'
                            }
                        </button>
                    </div>
                `;
                content.appendChild(trackEl);
            });
            
            // Add event listeners
            content.querySelectorAll('.track-mute').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const button = e.target.closest('.track-mute');
                    const trackName = button.getAttribute('data-track');
                    this.toggleTrackMute(trackName);
                    button.classList.toggle('muted');
                    const isMuted = button.classList.contains('muted');
                    button.title = isMuted ? 'Unmute track' : 'Mute track';
                    button.innerHTML = isMuted ? 
                        '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M3 5v6h3l4 4V1L6 5H3zm10.85 3L12 5.15v1.7L10.15 5l-.85.85L11.15 8 9.3 10.15l.85.85L12 9.15v1.7L13.85 10l.85-.85L12.85 8l1.85-1.85-.85-.85z"/></svg>' :
                        '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M3 5v6h3l4 4V1L6 5H3zm10.5 3c0-1.77-1-3.29-2.5-4.03v8.06c1.5-.74 2.5-2.26 2.5-4.03z"/></svg>';
                });
            });
        }
        
        // Show modal using ModalManager
        if (window.modalManager) {
            window.modalManager.show('trackInfoModal');
        }
    }
    
    toggleTrackMute(trackName) {
        // Toggle mute state
        const currentMuted = this.trackVisibility.get(trackName) === false;
        const newVisibility = currentMuted ? true : false;
        this.playbackEngine.setTrackMute(trackName, !newVisibility);
        
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
            fileType: 'o38-song',
            version: '2.0',
            tempo: this.currentBPM,
            timeSignature: `${BEATS_PER_MEASURE}/4`,
            orgMsPerTick: this.orgMsPerTick || null, // Preserve ORG timing info
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
                
                // Process volume automation - remove absolutePosition, keep only tick
                let volumeAutomation = null;
                if (note.volumeAutomation && Array.isArray(note.volumeAutomation)) {
                    if (note.volumeAutomation.length > 0) {
                        // Map to new format with only tick and volume
                        volumeAutomation = note.volumeAutomation.map(point => ({
                            tick: point.tick,
                            volume: point.volume
                        }));
                    } else {
                        // Preserve empty arrays
                        volumeAutomation = [];
                    }
                }
                
                // Process pan automation - keep only tick and pan
                let panAutomation = null;
                if (note.panAutomation && Array.isArray(note.panAutomation)) {
                    if (note.panAutomation.length > 0) {
                        // Map to new format with only tick and pan
                        panAutomation = note.panAutomation.map(point => ({
                            tick: point.tick,
                            pan: point.pan
                        }));
                    } else {
                        // Preserve empty arrays
                        panAutomation = [];
                    }
                }
                
                return {
                    pitch: note.key,
                    measure: measure,
                    beat: beatInMeasure,
                    duration: duration,
                    velocity: note.velocity,
                    pan: note.pan,
                    instrument: note.instrument,
                    pipi: note.pipi || 0,
                    volumeAutomation: volumeAutomation,
                    panAutomation: panAutomation
                };
            })
        };
        
        return JSON.stringify(songData, null, 2);
    }
    
    importFromJSON(jsonString) {
        try {
            // Stop playback if playing
            if (this.isPlaying) {
                this.stop();
            }
            
            const songData = JSON.parse(jsonString);
            
            // Check file type for version 2.0+
            if (songData.fileType && songData.fileType !== 'o38-song') {
                throw new Error('Invalid file type. Expected o38-song file.');
            }
            
            // Clear existing notes and org info
            this.noteManager.clearAll();
            this.orgTrackInfo = null;
            
            // Set tempo
            if (songData.tempo) {
                this.setTempo(songData.tempo);
            }
            
            // Restore ORG timing info if available
            if (songData.orgMsPerTick) {
                this.orgMsPerTick = songData.orgMsPerTick;
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
                
                // Calculate pixels per tick based on ORG timing or default
                let pixelsPerTick;
                if (this.orgMsPerTick) {
                    // Calculate based on actual ORG tick duration
                    const beatDuration = 60 / this.currentBPM; // seconds per beat
                    const ticksPerBeat = (beatDuration * 1000) / this.orgMsPerTick;
                    pixelsPerTick = GRID_WIDTH / ticksPerBeat;
                } else {
                    // Default assumption
                    pixelsPerTick = beatWidth / 48;
                }
                
                songData.notes.forEach(noteData => {
                    // Handle new format (measure/beat/duration)
                    if (noteData.measure !== undefined) {
                        const x = PIANO_KEY_WIDTH + (noteData.measure * measureWidth) + (noteData.beat * beatWidth);
                        const y = (NUM_OCTAVES * NOTES_PER_OCTAVE - 1 - noteData.pitch) * NOTE_HEIGHT;
                        const width = noteData.duration * beatWidth;
                        
                        // Process volume automation
                        let volumeAutomation = null;
                        if (noteData.volumeAutomation && noteData.volumeAutomation.length > 0) {
                            // For version 2.0, calculate position from tick
                            if (songData.version === '2.0') {
                                volumeAutomation = noteData.volumeAutomation.map(point => ({
                                    position: point.tick * pixelsPerTick,
                                    tick: point.tick,
                                    volume: point.volume
                                }));
                            } else {
                                // For older versions, keep the data as-is
                                volumeAutomation = noteData.volumeAutomation;
                            }
                        }
                        
                        // Process pan automation
                        let panAutomation = null;
                        if (noteData.panAutomation && noteData.panAutomation.length > 0) {
                            // For version 2.0, calculate position from tick
                            if (songData.version === '2.0') {
                                panAutomation = noteData.panAutomation.map(point => ({
                                    position: point.tick * pixelsPerTick,
                                    tick: point.tick,
                                    pan: point.pan
                                }));
                            } else {
                                // For older versions, keep the data as-is
                                panAutomation = noteData.panAutomation;
                            }
                        }
                        
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
                            volumeAutomation: volumeAutomation,
                            panAutomation: panAutomation
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
            
            // Update play button state
            if (typeof updatePlayButton === 'function') {
                updatePlayButton();
            }
            
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
    
    /**
     * Toggle between normal and high-resolution snap modes
     */
    toggleSnapMode() {
        this.snapMode = this.snapMode === 'normal' ? 'high-res' : 'normal';
        
        // Update grid width based on mode
        if (this.snapMode === 'high-res') {
            this.gridWidth = this.baseGridWidth * 2; // Double the grid width
        } else {
            this.gridWidth = this.baseGridWidth;
        }
        
        // Recalculate total width
        this.totalWidth = this.pianoKeyWidth + (this.totalMeasures * this.beatsPerMeasure * this.gridWidth);
        
        // Adjust scroll position to maintain view
        if (this.snapMode === 'high-res') {
            this.scrollX *= 2;
        } else {
            this.scrollX /= 2;
        }
        
        this.dirty = true;
        this.renderer.markFullRedraw();
        this.emit('scroll', { scrollX: this.scrollX, scrollY: this.scrollY });
    }
    
    /**
     * Get the current snap divisions based on snap mode
     */
    getSnapDivisions() {
        return this.snapMode === 'high-res' ? 64 : GRID_SUBDIVISIONS;
    }
}