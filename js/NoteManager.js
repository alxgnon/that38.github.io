import { GRID_WIDTH, GRID_SUBDIVISIONS, PIANO_KEY_WIDTH, NOTE_HEIGHT, NUM_OCTAVES, NOTES_PER_OCTAVE, BEATS_PER_MEASURE } from './constants.js';

/**
 * Manages note data and operations
 */
export class NoteManager {
    constructor() {
        this.notes = [];
        this.selectedNotes = new Set();
        this.clipboard = [];
        
        // Performance optimization: cache notes by measure
        this.notesByMeasure = new Map();
        this.adjacentNoteCache = new Map();
        this.needsNoteGrouping = true;
    }

    /**
     * Create a new note
     * @param {Object} noteData - Note properties
     * @returns {Object} The created note
     */
    createNote(noteData) {
        const note = {
            x: noteData.x,
            y: noteData.y,
            width: noteData.width || GRID_WIDTH / GRID_SUBDIVISIONS,
            height: noteData.height || NOTE_HEIGHT,
            key: noteData.key,
            velocity: noteData.velocity || 100,
            pan: noteData.pan || 0,
            instrument: noteData.instrument,
            pipi: noteData.pipi !== undefined ? noteData.pipi : null,
            id: this.generateNoteId()
        };
        
        this.notes.push(note);
        this.needsNoteGrouping = true;
        return note;
    }

    /**
     * Delete a note
     * @param {Object} note - Note to delete
     */
    deleteNote(note) {
        const index = this.notes.indexOf(note);
        if (index !== -1) {
            this.notes.splice(index, 1);
            this.selectedNotes.delete(note);
            this.needsNoteGrouping = true;
        }
    }

    /**
     * Delete notes in a region
     * @param {Object} bounds - Region bounds {x1, y1, x2, y2}
     */
    deleteNotesInRegion(bounds) {
        const notesToDelete = this.getNotesInRegion(bounds);
        notesToDelete.forEach(note => this.deleteNote(note));
    }

    /**
     * Select notes in a region
     * @param {Object} bounds - Region bounds {x1, y1, x2, y2}
     * @param {boolean} addToSelection - Whether to add to existing selection
     */
    selectNotesInRegion(bounds, addToSelection = false) {
        if (!addToSelection) {
            this.selectedNotes.clear();
        }
        
        const notesInRegion = this.getNotesInRegion(bounds);
        notesInRegion.forEach(note => this.selectedNotes.add(note));
    }

    /**
     * Get notes in a region
     * @param {Object} bounds - Region bounds {x1, y1, x2, y2}
     * @returns {Array} Notes in the region
     */
    getNotesInRegion(bounds) {
        const minX = Math.min(bounds.x1, bounds.x2);
        const maxX = Math.max(bounds.x1, bounds.x2);
        const minY = Math.min(bounds.y1, bounds.y2);
        const maxY = Math.max(bounds.y1, bounds.y2);
        
        return this.notes.filter(note => 
            note.x < maxX && note.x + note.width > minX &&
            note.y < maxY && note.y + note.height > minY
        );
    }

    /**
     * Get note at a specific position
     * @param {number} x - X coordinate
     * @param {number} y - Y coordinate
     * @returns {Object|null} Note at position or null
     */
    getNoteAt(x, y) {
        // Search in reverse order (top notes first)
        for (let i = this.notes.length - 1; i >= 0; i--) {
            const note = this.notes[i];
            if (x >= note.x && x <= note.x + note.width &&
                y >= note.y && y <= note.y + note.height) {
                return note;
            }
        }
        return null;
    }

    /**
     * Move selected notes
     * @param {number} deltaX - X offset
     * @param {number} deltaY - Y offset
     * @param {boolean} snapToGrid - Whether to snap to grid
     */
    moveSelectedNotes(deltaX, deltaY, snapToGrid = true) {
        const subdivisionWidth = GRID_WIDTH / GRID_SUBDIVISIONS;
        
        for (const note of this.selectedNotes) {
            let newX = note.x + deltaX;
            let newY = note.y + deltaY;
            
            // Snap to grid if enabled
            if (snapToGrid && deltaX !== 0) {
                newX = Math.round((newX - PIANO_KEY_WIDTH) / subdivisionWidth) * 
                       subdivisionWidth + PIANO_KEY_WIDTH;
            }
            
            // Ensure notes stay within bounds
            newX = Math.max(PIANO_KEY_WIDTH, newX);
            const newKey = Math.floor((NUM_OCTAVES * NOTES_PER_OCTAVE - 1) - (newY / NOTE_HEIGHT));
            if (newKey >= 0 && newKey < NUM_OCTAVES * NOTES_PER_OCTAVE) {
                note.x = newX;
                note.y = newY;
                note.key = newKey;
            }
        }
        
        this.needsNoteGrouping = true;
    }

    /**
     * Resize selected notes
     * @param {number} deltaWidth - Width change
     * @param {string} direction - Resize direction ('left' or 'right')
     */
    resizeSelectedNotes(deltaWidth, direction) {
        const subdivisionWidth = GRID_WIDTH / GRID_SUBDIVISIONS;
        
        for (const note of this.selectedNotes) {
            if (direction === 'right') {
                note.width = Math.max(subdivisionWidth, note.width + deltaWidth);
            } else if (direction === 'left') {
                const newX = note.x + deltaWidth;
                const newWidth = note.width - deltaWidth;
                if (newWidth >= subdivisionWidth && newX >= PIANO_KEY_WIDTH) {
                    note.x = newX;
                    note.width = newWidth;
                }
            }
        }
        
        this.needsNoteGrouping = true;
    }

    /**
     * Copy selected notes to clipboard
     */
    copySelectedNotes() {
        this.clipboard = [];
        
        if (this.selectedNotes.size === 0) return;
        
        // Find the leftmost note position
        let minX = Infinity;
        let minY = Infinity;
        for (const note of this.selectedNotes) {
            minX = Math.min(minX, note.x);
            minY = Math.min(minY, note.y);
        }
        
        // Copy notes with relative positions
        for (const note of this.selectedNotes) {
            this.clipboard.push({
                ...note,
                relativeX: note.x - minX,
                relativeY: note.y - minY,
                id: undefined // Will get new ID when pasted
            });
        }
    }

    /**
     * Cut selected notes
     */
    cutSelectedNotes() {
        this.copySelectedNotes();
        this.deleteSelectedNotes();
    }

    /**
     * Paste notes from clipboard
     * @param {number} x - Paste position X
     * @param {number} y - Paste position Y
     */
    pasteNotes(x, y) {
        if (this.clipboard.length === 0) return;
        
        this.selectedNotes.clear();
        
        // Paste notes at the specified position
        this.clipboard.forEach(clipNote => {
            const newNote = this.createNote({
                x: x + clipNote.relativeX,
                y: y + clipNote.relativeY,
                width: clipNote.width,
                height: clipNote.height,
                key: clipNote.key,
                velocity: clipNote.velocity,
                pan: clipNote.pan,
                instrument: clipNote.instrument
            });
            this.selectedNotes.add(newNote);
        });
    }

    /**
     * Delete all selected notes
     */
    deleteSelectedNotes() {
        for (const note of this.selectedNotes) {
            this.deleteNote(note);
        }
        this.selectedNotes.clear();
    }

    /**
     * Select all notes
     */
    selectAll() {
        this.selectedNotes.clear();
        this.notes.forEach(note => this.selectedNotes.add(note));
    }

    /**
     * Clear all notes
     */
    clearAll() {
        this.notes = [];
        this.selectedNotes.clear();
        this.notesByMeasure.clear();
        this.adjacentNoteCache.clear();
        this.needsNoteGrouping = true;
    }

    /**
     * Group notes by measure for performance
     */
    groupNotesByMeasure() {
        if (!this.needsNoteGrouping) return;
        
        this.notesByMeasure.clear();
        
        for (const note of this.notes) {
            const measure = Math.floor((note.x - PIANO_KEY_WIDTH) / (GRID_WIDTH * BEATS_PER_MEASURE));
            if (!this.notesByMeasure.has(measure)) {
                this.notesByMeasure.set(measure, []);
            }
            this.notesByMeasure.get(measure).push(note);
        }
        
        this.needsNoteGrouping = false;
    }

    /**
     * Get notes in visible measures
     * @param {number} startMeasure - First visible measure
     * @param {number} endMeasure - Last visible measure
     * @returns {Array} Notes in visible measures
     */
    getNotesInMeasures(startMeasure, endMeasure) {
        this.groupNotesByMeasure();
        
        const visibleNotes = [];
        for (let measure = startMeasure; measure <= endMeasure; measure++) {
            const notesInMeasure = this.notesByMeasure.get(measure);
            if (notesInMeasure) {
                visibleNotes.push(...notesInMeasure);
            }
        }
        
        return visibleNotes;
    }

    /**
     * Find adjacent notes (for legato/overlap detection)
     * @param {Object} note - Note to check
     * @returns {Object} Adjacent notes {before, after}
     */
    findAdjacentNotes(note) {
        const cacheKey = `${note.id}-${note.x}-${note.width}`;
        if (this.adjacentNoteCache.has(cacheKey)) {
            return this.adjacentNoteCache.get(cacheKey);
        }
        
        let before = null;
        let after = null;
        
        for (const other of this.notes) {
            if (other === note || other.key !== note.key) continue;
            
            // Check if notes are adjacent or overlapping
            if (other.x + other.width >= note.x - 1 && other.x + other.width < note.x + note.width) {
                if (!before || other.x > before.x) {
                    before = other;
                }
            }
            if (other.x <= note.x + note.width + 1 && other.x > note.x) {
                if (!after || other.x < after.x) {
                    after = other;
                }
            }
        }
        
        const result = { before, after };
        this.adjacentNoteCache.set(cacheKey, result);
        return result;
    }

    /**
     * Generate unique note ID
     */
    generateNoteId() {
        return `note-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Get note statistics
     */
    getStatistics() {
        return {
            totalNotes: this.notes.length,
            selectedNotes: this.selectedNotes.size,
            instruments: [...new Set(this.notes.map(n => n.instrument))],
            keyRange: this.notes.length > 0 ? {
                min: Math.min(...this.notes.map(n => n.key)),
                max: Math.max(...this.notes.map(n => n.key))
            } : { min: 0, max: 0 }
        };
    }
}