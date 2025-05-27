/**
 * Minimal example of using the PlaybackEngine
 */

import PlaybackEngine from './PlaybackEngine.js';

// Create player instance
const player = new PlaybackEngine();

// Initialize (loads wavetable)
await player.init();

// Load a song from JSON
const songData = {
    version: "1.1",
    name: "My Song",
    tempo: 120,
    loop: {
        enabled: true,
        startMeasure: 0,
        endMeasure: 4
    },
    notes: [
        {
            pitch: 60,        // MIDI note number (60 = C4)
            measure: 0,       // Measure number
            beat: 0,          // Beat within measure (0-15 for 16th notes)
            duration: 4,      // Duration in beats
            velocity: 100,    // Volume (0-127)
            pan: 0,          // Pan (-100 to 100)
            instrument: "ORG_M00"  // Instrument name
        }
        // ... more notes
    ]
};

player.loadSong(songData);

// Basic controls
player.play();           // Start playback
player.pause();          // Pause playback
player.stop();           // Stop and reset to beginning
player.setVolume(50);    // Set volume (0-100)
player.setTempo(140);    // Change tempo

// Loop control
player.setLoop(true, 0, 4);  // Enable loop from measure 0 to 4

// Track visibility
player.setTrackVisibility("ORG_M00", false);  // Hide track
player.setTrackVisibility("ORG_M00", true);   // Show track

// Get track list
const tracks = player.getTracks();
// Returns: [{ name: "ORG_M00", noteCount: 5 }, ...]

// Callbacks for visualization
const player2 = new PlaybackEngine({
    onNoteStart: (note) => {
        console.log('Note started:', note);
    },
    onNoteEnd: (note) => {
        console.log('Note ended:', note);
    },
    onMeasureChange: (measure) => {
        console.log('Current measure:', measure);
    },
    onStop: () => {
        console.log('Playback stopped');
    }
});