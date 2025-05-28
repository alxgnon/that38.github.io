import { NOTES_PER_OCTAVE, NOTE_HEIGHT, PIANO_KEY_WIDTH, COLORS } from './constants.js';

/**
 * Counterpoint Assistant - helps with harmonic analysis and counterpoint suggestions
 */
export class CounterpointAssistant {
    constructor(pianoRoll) {
        this.pianoRoll = pianoRoll;
        this.enabled = false;
        
        // Interval colors for highlighting
        this.intervalColors = {
            0: { color: '#ff6b6b', name: 'Unison' },           // Red
            6: { color: '#ff9999', name: 'Quartertone' },      // Light red
            12: { color: '#ffaa88', name: 'Semitone' },        // Orange
            18: { color: '#ffcc66', name: 'Neutral Second' },  // Light orange
            24: { color: '#ffdd44', name: 'Major Second' },    // Yellow
            30: { color: '#ddee66', name: 'Neutral Third' },   // Yellow-green
            36: { color: '#99dd88', name: 'Minor Third' },     // Light green
            42: { color: '#66cc99', name: 'Major Third' },     // Green
            48: { color: '#44bbaa', name: 'Perfect Fourth' },  // Teal
            54: { color: '#55aacc', name: 'Tritone' },         // Light blue
            60: { color: '#6699ff', name: 'Perfect Fifth' },   // Blue
            66: { color: '#8888ff', name: 'Neutral Sixth' },   // Blue-purple
            72: { color: '#aa77ff', name: 'Minor Sixth' },     // Purple
            78: { color: '#cc66ff', name: 'Major Sixth' },     // Violet
            84: { color: '#dd55ee', name: 'Neutral Seventh' }, // Pink-purple
            90: { color: '#ee44dd', name: 'Minor Seventh' },   // Pink
            96: { color: '#ff55cc', name: 'Major Seventh' },   // Hot pink
            102: { color: '#ff66aa', name: 'Neutral Octave' }, // Pink-red
        };
        
        // Common chord patterns in 72-EDO
        this.chordPatterns = {
            major: [0, 42, 60],      // Major triad
            minor: [0, 36, 60],      // Minor triad
            diminished: [0, 36, 54], // Diminished triad
            augmented: [0, 42, 66],  // Augmented triad
            sus2: [0, 24, 60],       // Sus2
            sus4: [0, 48, 60],       // Sus4
            neutral: [0, 30, 60],    // Neutral triad (unique to microtonal)
            // 7th chords
            maj7: [0, 42, 60, 96],   // Major 7th
            dom7: [0, 42, 60, 90],   // Dominant 7th
            min7: [0, 36, 60, 90],   // Minor 7th
            dim7: [0, 36, 54, 84],   // Diminished 7th
        };
    }
    
    /**
     * Toggle the assistant on/off
     */
    toggle() {
        this.enabled = !this.enabled;
        this.pianoRoll.dirty = true;
    }
    
    /**
     * Get all notes at a specific time position
     */
    getNotesAtTime(x) {
        const notes = [];
        for (const note of this.pianoRoll.noteManager.notes) {
            if (note.x <= x && note.x + note.width > x) {
                notes.push(note);
            }
        }
        return notes.sort((a, b) => b.key - a.key); // Sort high to low
    }
    
    /**
     * Analyze intervals between notes
     */
    analyzeIntervals(notes) {
        const intervals = [];
        const sortedNotes = [...notes].sort((a, b) => a.key - b.key);
        
        // Get all intervals between consecutive notes
        for (let i = 0; i < sortedNotes.length - 1; i++) {
            const interval = sortedNotes[i + 1].key - sortedNotes[i].key;
            intervals.push({
                from: sortedNotes[i],
                to: sortedNotes[i + 1],
                interval: interval,
                reduced: interval % NOTES_PER_OCTAVE,
                octaves: Math.floor(interval / NOTES_PER_OCTAVE)
            });
        }
        
        // Also get interval from lowest to highest
        if (sortedNotes.length > 2) {
            const span = sortedNotes[sortedNotes.length - 1].key - sortedNotes[0].key;
            intervals.push({
                from: sortedNotes[0],
                to: sortedNotes[sortedNotes.length - 1],
                interval: span,
                reduced: span % NOTES_PER_OCTAVE,
                octaves: Math.floor(span / NOTES_PER_OCTAVE),
                isSpan: true
            });
        }
        
        return intervals;
    }
    
    /**
     * Identify chord types
     */
    identifyChord(notes) {
        if (notes.length < 3) return null;
        
        // Sort notes by pitch (low to high)
        const sortedNotes = [...notes].sort((a, b) => a.key - b.key);
        const lowestNote = sortedNotes[0];
        
        // Get intervals from the lowest note, keeping them within one octave
        const intervals = sortedNotes.map(n => {
            const interval = n.key - lowestNote.key;
            // Reduce to within one octave while preserving the interval structure
            return interval % NOTES_PER_OCTAVE;
        }).filter((v, i, a) => a.indexOf(v) === i); // Remove duplicates
        
        // Check against known patterns
        for (const [name, pattern] of Object.entries(this.chordPatterns)) {
            if (this.matchesPattern(intervals, pattern)) {
                return name;
            }
        }
        
        return null;
    }
    
    /**
     * Check if intervals match a chord pattern
     */
    matchesPattern(intervals, pattern) {
        if (intervals.length !== pattern.length) return false;
        
        // Allow some tolerance for microtonal variations (±3 = ±1/2 semitone)
        for (let i = 0; i < intervals.length; i++) {
            const diff = Math.abs(intervals[i] - pattern[i]);
            if (diff > 3) return false;
        }
        return true;
    }
    
    /**
     * Draw the counterpoint assistant overlay
     */
    draw(ctx) {
        if (!this.enabled) return;
        
        const mouseX = this.pianoRoll.inputHandler.mouseX + this.pianoRoll.scrollX;
        const hoveredNote = this.getHoveredNote();
        
        // Draw interval relationships
        if (hoveredNote) {
            this.drawIntervalHighlights(ctx, hoveredNote);
        }
        
        // Draw harmonic analysis at mouse position
        this.drawHarmonicAnalysis(ctx, mouseX);
    }
    
    /**
     * Get the note under the mouse cursor
     */
    getHoveredNote() {
        const x = this.pianoRoll.inputHandler.mouseX + this.pianoRoll.scrollX;
        const y = this.pianoRoll.inputHandler.mouseY + this.pianoRoll.scrollY;
        
        for (const note of this.pianoRoll.noteManager.notes) {
            if (x >= note.x && x <= note.x + note.width &&
                y >= note.y && y <= note.y + note.height) {
                return note;
            }
        }
        return null;
    }
    
    /**
     * Draw interval highlights on the piano
     */
    drawIntervalHighlights(ctx, hoveredNote) {
        ctx.save();
        
        // Highlight intervals on piano keys
        const baseKey = hoveredNote.key;
        
        for (const [interval, info] of Object.entries(this.intervalColors)) {
            const targetKey1 = baseKey + parseInt(interval);
            const targetKey2 = baseKey - parseInt(interval);
            
            // Draw highlights for both directions
            if (targetKey1 >= 0 && targetKey1 < NOTES_PER_OCTAVE * 8) {
                this.drawKeyHighlight(ctx, targetKey1, info.color, 0.3);
            }
            
            if (targetKey2 >= 0 && targetKey2 < NOTES_PER_OCTAVE * 8 && interval > 0) {
                this.drawKeyHighlight(ctx, targetKey2, info.color, 0.3);
            }
        }
        
        // Highlight the base note
        this.drawKeyHighlight(ctx, baseKey, '#ffffff', 0.5);
        
        ctx.restore();
    }
    
    /**
     * Draw a highlight on a piano key
     */
    drawKeyHighlight(ctx, keyNumber, color, alpha) {
        const y = (NOTES_PER_OCTAVE * 8 - 1 - keyNumber) * NOTE_HEIGHT - this.pianoRoll.scrollY;
        
        ctx.fillStyle = color;
        ctx.globalAlpha = alpha;
        ctx.fillRect(0, y, PIANO_KEY_WIDTH, NOTE_HEIGHT);
        ctx.globalAlpha = 1;
    }
    
    /**
     * Draw harmonic analysis
     */
    drawHarmonicAnalysis(ctx, x) {
        const notes = this.getNotesAtTime(x);
        if (notes.length < 2) return;
        
        // Identify chord
        const chordType = this.identifyChord(notes);
        
        // Draw analysis panel
        const panelX = x - this.pianoRoll.scrollX + 10;
        const panelY = 10;
        const panelWidth = 200;
        const lineHeight = 16;
        
        ctx.save();
        
        // Background
        ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
        ctx.fillRect(panelX, panelY, panelWidth, lineHeight * (notes.length + 3));
        
        // Text
        ctx.fillStyle = '#ffffff';
        ctx.font = '12px monospace';
        
        // Chord type
        if (chordType) {
            ctx.fillText(`Chord: ${chordType}`, panelX + 5, panelY + lineHeight);
        }
        
        // Intervals
        const intervals = this.analyzeIntervals(notes);
        let textY = panelY + lineHeight * 2;
        
        ctx.fillText('Intervals:', panelX + 5, textY);
        textY += lineHeight;
        
        for (const int of intervals.slice(0, 5)) { // Limit to 5 intervals
            const intervalInfo = this.intervalColors[int.reduced] || { name: `${int.reduced}/72` };
            const octaveText = int.octaves > 0 ? ` +${int.octaves}oct` : '';
            const spanText = int.isSpan ? ' (span)' : '';
            ctx.fillText(`  ${intervalInfo.name}${octaveText}${spanText}`, panelX + 5, textY);
            textY += lineHeight;
        }
        
        ctx.restore();
    }
    
    /**
     * Get suggested notes for counterpoint
     */
    getSuggestedNotes(baseNote) {
        // Common consonant intervals in 72-EDO
        const consonantIntervals = [
            24,  // Major second
            36,  // Minor third
            42,  // Major third
            48,  // Perfect fourth
            60,  // Perfect fifth
            72,  // Octave
        ];
        
        const suggestions = [];
        for (const interval of consonantIntervals) {
            const upKey = baseNote.key + interval;
            const downKey = baseNote.key - interval;
            
            if (upKey < NOTES_PER_OCTAVE * 8) {
                suggestions.push({ key: upKey, interval });
            }
            if (downKey >= 0) {
                suggestions.push({ key: downKey, interval: -interval });
            }
        }
        
        return suggestions;
    }
}