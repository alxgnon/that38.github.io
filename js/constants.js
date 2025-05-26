// Musical constants
export const NOTES_PER_OCTAVE = 72; // 72 EDO tuning system
export const NUM_OCTAVES = 8;
export const NOTES_PER_SEMITONE = 6; // 6 microtonal divisions per semitone
export const TOTAL_KEYS = NUM_OCTAVES * NOTES_PER_OCTAVE;

// Audio constants
export const BASE_FREQUENCY = 440; // A4 in Hz
export const WAVE_SAMPLES = 256; // Samples per wave in wavetable
export const BASE_SAMPLE_RATE = 22050; // Base sample rate for drums
export const MAX_DRUMS = 6; // Maximum number of drum samples
export const MAX_MELODIC_SAMPLES = 100; // M00-M99

// Timing constants
export const DEFAULT_BPM = 120;
export const BEATS_PER_MEASURE = 4; // 4/4 time
export const GRID_SUBDIVISIONS = 4; // Each beat divided into 4 parts (16th notes)

// UI dimensions
export const PIANO_KEY_WIDTH = 60;
export const NOTE_HEIGHT = 3;
export const GRID_WIDTH = 40;
export const TOTAL_MEASURES = 128;
export const RESIZE_HANDLE_WIDTH = 8; // Pixels from edge to detect resize

// UI constants
export const PAN_BAR_HEIGHT = 60;
export const VELOCITY_BAR_HEIGHT = 60;
export const DEFAULT_VELOCITY = 100;
export const DEFAULT_VOLUME = 30;

// Performance constants
export const VISIBLE_AREA_PADDING = 100; // Extra pixels to render outside visible area
export const PORTAMENTO_TIME = 0.05; // Seconds for pitch glide
export const AUDIO_STOP_DELAY = 0.01; // Brief delay to prevent audio glitches

// Organya format constants
export const ORG_FILE_SIGNATURE = 'Org-02';
export const ORG_VERSION = 2;
export const ORG_MAX_KEY = 95;
export const ORG_VELOCITY_SCALE = 2; // Convert 0-127 to 0-254 range

// Colors
export const COLORS = {
    background: '#222',
    whiteKey: '#3a3a3a',
    whiteKeyHighlight: '#4a4a4a',
    blackKey: '#1a1a1a',
    blackKeyHighlight: '#2a2a2a',
    keyBorder: '#111',
    keyShadow: 'rgba(0, 0, 0, 0.5)',
    grid: '#2a2a2a',
    note: '#4a9eff',
    noteActive: '#6ab7ff',
    noteBorder: '#357abd',
    playhead: '#ff4444',
    text: '#888',
    loopMarker: '#ffaa00',
    loopBackground: 'rgba(255, 170, 0, 0.1)'
};

// Instrument color palette
export const INSTRUMENT_COLOR_PALETTE = [
    { note: '#ff6b6b', border: '#cc5555' }, // Red
    { note: '#4ecdc4', border: '#3ba89f' }, // Teal
    { note: '#ffe66d', border: '#ccb755' }, // Yellow
    { note: '#a8e6cf', border: '#86b9a6' }, // Mint
    { note: '#ff8b94', border: '#cc6f76' }, // Pink
    { note: '#c7ceea', border: '#9fa5bb' }, // Lavender
    { note: '#ffaaa5', border: '#cc8884' }, // Coral
    { note: '#88d8b0', border: '#6dac8d' }, // Seafoam
    { note: '#fdcb6e', border: '#caa258' }, // Orange
    { note: '#74b9ff', border: '#5d94cc' }, // Sky blue
    { note: '#a29bfe', border: '#827ccb' }, // Purple
    { note: '#fab1a0', border: '#c88e80' }, // Peach
    { note: '#55a3ff', border: '#4482cc' }, // Blue
    { note: '#fd79a8', border: '#ca6186' }, // Rose
    { note: '#6c5ce7', border: '#564ab9' }, // Violet
    { note: '#00b894', border: '#009376' }  // Emerald
];