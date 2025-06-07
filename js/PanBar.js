import { PIANO_KEY_WIDTH, GRID_WIDTH, BEATS_PER_MEASURE, PAN_BAR_HEIGHT } from './constants.js';

/**
 * PanBar - Handles pan editing for notes
 */
export class PanBar {
    constructor(canvas, pianoRoll) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.pianoRoll = pianoRoll;
        this.draggingNote = null;
        this.hoveredNote = null;
        this.scrollX = pianoRoll.scrollX || 0;
        
        this.resize();
        this.setupEventListeners();
        this.draw();
    }
    
    resize() {
        const container = this.canvas.parentElement;
        this.canvas.width = container.clientWidth;
        this.canvas.height = container.clientHeight;
        this.draw();
    }
    
    setupEventListeners() {
        this.canvas.addEventListener('mousedown', this.handleMouseDown.bind(this));
        this.canvas.addEventListener('mousemove', this.handleMouseMove.bind(this));
        this.canvas.addEventListener('mouseup', this.handleMouseUp.bind(this));
        this.canvas.addEventListener('mouseleave', this.handleMouseLeave.bind(this));
        
        // Touch events
        this.canvas.addEventListener('touchstart', this.handleTouchStart.bind(this), { passive: false });
        this.canvas.addEventListener('touchmove', this.handleTouchMove.bind(this), { passive: false });
        this.canvas.addEventListener('touchend', this.handleTouchEnd.bind(this), { passive: false });
        this.canvas.addEventListener('touchcancel', this.handleTouchEnd.bind(this), { passive: false });
        
        // Handle window resize
        window.addEventListener('resize', () => {
            this.resize();
        });
        
        // Listen for piano roll changes
        this.pianoRoll.addEventListener('scroll', (data) => {
            this.scrollX = data.scrollX;
            this.draw();
        });
        this.pianoRoll.addEventListener('notesChanged', () => this.draw());
        this.pianoRoll.addEventListener('selectionChanged', () => this.draw());
        this.pianoRoll.addEventListener('playbackUpdate', () => this.draw());
    }
    
    handleMouseDown(e) {
        const rect = this.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left + this.scrollX;
        const y = e.clientY - rect.top;
        
        // Find note at position
        const note = this.findNoteAtX(x);
        if (note) {
            this.draggingNote = note;
            
            // Store initial pan values for all selected notes
            if (this.pianoRoll.noteManager.selectedNotes.has(note)) {
                this.initialPanValues = new Map();
                for (const selectedNote of this.pianoRoll.noteManager.selectedNotes) {
                    this.initialPanValues.set(selectedNote, selectedNote.pan || 0);
                }
                this.dragStartY = y;
                this.dragStartPan = note.pan || 0;
            }
            
            this.updateNotePan(note, y);
        }
    }
    
    handleMouseMove(e) {
        const rect = this.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left + this.scrollX;
        const y = e.clientY - rect.top;
        
        if (this.draggingNote) {
            if (this.initialPanValues && this.pianoRoll.noteManager.selectedNotes.has(this.draggingNote)) {
                // Update all selected notes relative to the drag
                const centerY = this.canvas.height / 2;
                const currentPan = Math.round(((y - centerY) / centerY) * 100);
                const panDelta = currentPan - this.dragStartPan;
                
                for (const [note, initialPan] of this.initialPanValues) {
                    const newPan = Math.max(-100, Math.min(100, initialPan + panDelta));
                    note.pan = Math.round(newPan);
                }
                
                this.pianoRoll.dirty = true;
                this.draw();
            } else {
                // Update single note
                this.updateNotePan(this.draggingNote, y);
            }
        } else {
            const note = this.findNoteAtX(x);
            if (note !== this.hoveredNote) {
                this.hoveredNote = note;
                this.canvas.style.cursor = note ? 'pointer' : 'default';
                this.draw();
            }
        }
    }
    
    handleMouseUp() {
        this.draggingNote = null;
        this.initialPanValues = null;
        this.dragStartY = null;
        this.dragStartPan = null;
    }
    
    handleMouseLeave() {
        this.draggingNote = null;
        this.hoveredNote = null;
        this.canvas.style.cursor = 'default';
        this.draw();
    }
    
    findNoteAtX(x) {
        const notes = this.pianoRoll.noteManager.notes;
        const scaleFactor = this.pianoRoll.gridWidth / this.pianoRoll.baseGridWidth;
        
        for (const note of notes) {
            // Scale note position for comparison
            const scaledX = PIANO_KEY_WIDTH + (note.x - PIANO_KEY_WIDTH) * scaleFactor;
            
            // Check if x is near the note's start position
            if (Math.abs(x - scaledX) < 5) {
                return note;
            }
        }
        return null;
    }
    
    updateNotePan(note, y) {
        // Convert y position to pan value (-100 to 100)
        const centerY = this.canvas.height / 2;
        const pan = Math.max(-100, Math.min(100, ((y - centerY) / centerY) * 100));
        note.pan = Math.round(pan);
        this.pianoRoll.dirty = true;
        this.draw();
    }
    
    draw() {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        
        // Adjust for scroll
        this.ctx.save();
        this.ctx.translate(-this.scrollX, 0);
        
        // Draw playhead if playing or paused
        if (this.pianoRoll.isPlaying || this.pianoRoll.isPaused) {
            const currentMeasure = this.pianoRoll.currentMeasure;
            const measureWidth = BEATS_PER_MEASURE * this.pianoRoll.gridWidth;
            const measureX = PIANO_KEY_WIDTH + currentMeasure * measureWidth;
            
            this.ctx.fillStyle = 'rgba(255, 68, 68, 0.1)';
            this.ctx.fillRect(measureX, 0, measureWidth, this.canvas.height);
        }
        
        // Draw center line
        this.ctx.strokeStyle = '#444';
        this.ctx.lineWidth = 1;
        this.ctx.beginPath();
        this.ctx.moveTo(0, this.canvas.height / 2);
        this.ctx.lineTo(this.canvas.width + this.pianoRoll.scrollX, this.canvas.height / 2);
        this.ctx.stroke();
        
        // Draw grid lines
        this.ctx.strokeStyle = '#333';
        this.ctx.lineWidth = 0.5;
        const measureWidth = this.pianoRoll.gridWidth * BEATS_PER_MEASURE;
        for (let x = PIANO_KEY_WIDTH; x <= this.canvas.width + this.scrollX; x += measureWidth) {
            this.ctx.beginPath();
            this.ctx.moveTo(x, 0);
            this.ctx.lineTo(x, this.canvas.height);
            this.ctx.stroke();
        }
        
        // Draw note pan handles
        const notes = this.pianoRoll.noteManager.notes;
        const scaleFactor = this.pianoRoll.gridWidth / this.pianoRoll.baseGridWidth;
        
        for (const note of notes) {
            // Skip if track is hidden
            if (this.pianoRoll.trackVisibility.get(note.instrument) === false) {
                continue;
            }
            const x = PIANO_KEY_WIDTH + (note.x - PIANO_KEY_WIDTH) * scaleFactor;
            const pan = note.pan || 0;
            const y = this.canvas.height / 2 + (pan / 100) * (this.canvas.height / 2);
            
            // Draw handle
            const isHovered = note === this.hoveredNote;
            const isDragging = note === this.draggingNote;
            const isSelected = this.pianoRoll.noteManager.selectedNotes.has(note);
            
            // Get instrument color
            const instrumentColor = this.pianoRoll.getInstrumentColor(note.instrument);
            
            // Determine color based on state
            let color = instrumentColor.note;
            if (isSelected) {
                color = '#ffa500';  // Keep orange for selected notes, even when dragging
            } else if (isDragging) {
                color = '#ff8800';  // Orange when dragging
            } else if (isHovered) {
                // Brighten the instrument color slightly for hover
                color = this.adjustBrightness(instrumentColor.note, 20);
            }
            
            // Draw handle with opaque background to prevent color mixing
            const handleRadius = isSelected ? 5 : 4;
            
            // Draw a dark background circle first to block the playhead color
            this.ctx.fillStyle = '#1a1a1a';
            this.ctx.beginPath();
            this.ctx.arc(x, y, handleRadius + 1, 0, Math.PI * 2);
            this.ctx.fill();
            
            // Draw the handle with its proper color
            this.ctx.fillStyle = color;
            this.ctx.beginPath();
            this.ctx.arc(x, y, handleRadius, 0, Math.PI * 2);
            this.ctx.fill();
            
            // Apply velocity-based transparency overlay (darker = lower velocity)
            if (!isSelected && !isDragging) {
                const velocity = note.velocity || 100;
                const velocityAlpha = 1 - (velocity / 127) * 0.6;
                this.ctx.fillStyle = `rgba(0, 0, 0, ${velocityAlpha})`;
                this.ctx.beginPath();
                this.ctx.arc(x, y, handleRadius, 0, Math.PI * 2);
                this.ctx.fill();
            }
            
            // Add selection ring for selected notes
            if (isSelected && !isDragging) {
                this.ctx.strokeStyle = color;
                this.ctx.lineWidth = 2;
                this.ctx.beginPath();
                this.ctx.arc(x, y, 7, 0, Math.PI * 2);
                this.ctx.stroke();
            }
        }
        
        this.ctx.restore();
        
        // Draw label area background to match piano keys
        this.ctx.save();
        this.ctx.fillStyle = '#2a2a2a';
        this.ctx.fillRect(0, 0, PIANO_KEY_WIDTH, this.canvas.height);
        
        // Draw border to match piano key area
        this.ctx.strokeStyle = '#444';
        this.ctx.lineWidth = 1;
        this.ctx.beginPath();
        this.ctx.moveTo(PIANO_KEY_WIDTH, 0);
        this.ctx.lineTo(PIANO_KEY_WIDTH, this.canvas.height);
        this.ctx.stroke();
        
        // Draw labels
        this.ctx.fillStyle = '#888';
        this.ctx.font = '10px Arial';
        this.ctx.textAlign = 'center';
        this.ctx.fillText('L', PIANO_KEY_WIDTH / 2, 15);
        this.ctx.fillText('R', PIANO_KEY_WIDTH / 2, this.canvas.height - 5);
        this.ctx.fillText('C', PIANO_KEY_WIDTH / 2, this.canvas.height / 2 + 3);
        this.ctx.restore();
    }
    
    /**
     * Adjust color brightness
     */
    adjustBrightness(color, percent) {
        const num = parseInt(color.replace('#', ''), 16);
        const amt = Math.round(2.55 * percent);
        const R = (num >> 16) + amt;
        const G = (num >> 8 & 0x00FF) + amt;
        const B = (num & 0x0000FF) + amt;
        
        return '#' + (0x1000000 + (R < 255 ? R < 1 ? 0 : R : 255) * 0x10000 +
            (G < 255 ? G < 1 ? 0 : G : 255) * 0x100 +
            (B < 255 ? B < 1 ? 0 : B : 255))
            .toString(16).slice(1);
    }
    
    /**
     * Handle touch start
     */
    handleTouchStart(e) {
        e.preventDefault();
        if (e.touches.length === 1) {
            const touch = e.touches[0];
            const rect = this.canvas.getBoundingClientRect();
            const x = touch.clientX - rect.left + this.scrollX;
            const y = touch.clientY - rect.top;
            
            // Store touch identifier
            this.currentTouchId = touch.identifier;
            
            // Simulate mouse down
            this.handleMouseDown({ clientX: touch.clientX, clientY: touch.clientY });
        }
    }
    
    /**
     * Handle touch move
     */
    handleTouchMove(e) {
        e.preventDefault();
        if (e.touches.length === 1 && this.currentTouchId !== undefined) {
            // Find the touch we're tracking
            let touch = null;
            for (let i = 0; i < e.touches.length; i++) {
                if (e.touches[i].identifier === this.currentTouchId) {
                    touch = e.touches[i];
                    break;
                }
            }
            
            if (touch) {
                // Simulate mouse move
                this.handleMouseMove({ clientX: touch.clientX, clientY: touch.clientY });
            }
        }
    }
    
    /**
     * Handle touch end
     */
    handleTouchEnd(e) {
        e.preventDefault();
        
        // Check if our tracked touch ended
        let touchEnded = true;
        for (let i = 0; i < e.touches.length; i++) {
            if (e.touches[i].identifier === this.currentTouchId) {
                touchEnded = false;
                break;
            }
        }
        
        if (touchEnded) {
            this.handleMouseUp();
            this.currentTouchId = undefined;
        }
    }
}