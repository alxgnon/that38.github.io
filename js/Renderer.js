import { 
    COLORS, 
    PIANO_KEY_WIDTH, 
    NOTE_HEIGHT, 
    GRID_WIDTH, 
    NOTES_PER_OCTAVE,
    BEATS_PER_MEASURE,
    VISIBLE_AREA_PADDING
} from './constants.js';

/**
 * Handles all canvas rendering operations
 */
export class Renderer {
    constructor(canvas, pianoRoll) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d', { alpha: false });
        this.pianoRoll = pianoRoll;
        
        // Performance tracking
        this.lastFrameTime = 0;
        this.frameCount = 0;
        this.fps = 0;
        
        // Note name patterns
        this.noteNames = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
        this.microtonalMarkers = ['', '↑', '⇈', '⇊', '↓', '↓↓'];
    }

    /**
     * Main draw function
     */
    draw() {
        const now = performance.now();
        
        // Clear canvas
        this.ctx.fillStyle = COLORS.background;
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        
        // Save context state
        this.ctx.save();
        
        // Apply scroll transform
        this.ctx.translate(-this.pianoRoll.scrollX, -this.pianoRoll.scrollY);
        
        // Draw layers in order
        this.drawGrid();
        this.drawMeasureNumbers();
        this.drawLoopMarkers();
        this.drawNotes();
        this.drawSelectionBox();
        
        // Restore context state
        this.ctx.restore();
        
        // Draw piano keys (not affected by scroll)
        this.drawPianoKeys();
        
        // Draw playhead last so it appears on top
        this.ctx.save();
        this.ctx.translate(-this.pianoRoll.scrollX, -this.pianoRoll.scrollY);
        this.drawPlayhead();
        this.ctx.restore();
        
        // Draw FPS if enabled
        if (this.pianoRoll.showFPS) {
            this.drawFPS();
        }
        
        // Update FPS counter
        this.updateFPS(now);
    }

    /**
     * Draw grid lines
     */
    drawGrid() {
        const startX = Math.max(0, this.pianoRoll.scrollX - VISIBLE_AREA_PADDING);
        const endX = Math.min(this.pianoRoll.totalWidth, 
            this.pianoRoll.scrollX + this.canvas.width + VISIBLE_AREA_PADDING);
        const startY = Math.max(0, this.pianoRoll.scrollY - VISIBLE_AREA_PADDING);
        const endY = Math.min(this.pianoRoll.totalHeight, 
            this.pianoRoll.scrollY + this.canvas.height + VISIBLE_AREA_PADDING);
        
        // Vertical lines (beats)
        this.ctx.strokeStyle = COLORS.grid;
        this.ctx.lineWidth = 1;
        
        for (let x = PIANO_KEY_WIDTH; x < endX; x += GRID_WIDTH) {
            if (x < startX) continue;
            
            // Stronger lines for measure boundaries
            const beatIndex = (x - PIANO_KEY_WIDTH) / GRID_WIDTH;
            if (beatIndex % BEATS_PER_MEASURE === 0) {
                this.ctx.strokeStyle = '#444';
                this.ctx.lineWidth = 2;
            } else {
                this.ctx.strokeStyle = COLORS.grid;
                this.ctx.lineWidth = 1;
            }
            
            this.ctx.beginPath();
            this.ctx.moveTo(x, startY);
            this.ctx.lineTo(x, endY);
            this.ctx.stroke();
        }
        
        // Horizontal lines (notes)
        this.ctx.strokeStyle = COLORS.grid;
        this.ctx.lineWidth = 1;
        
        for (let y = 0; y < endY; y += NOTE_HEIGHT) {
            if (y < startY) continue;
            
            // Highlight octave boundaries
            const noteInOctave = Math.floor(y / NOTE_HEIGHT) % NOTES_PER_OCTAVE;
            if (noteInOctave === 0) {
                this.ctx.strokeStyle = '#444';
            } else {
                this.ctx.strokeStyle = COLORS.grid;
            }
            
            this.ctx.beginPath();
            this.ctx.moveTo(startX, y);
            this.ctx.lineTo(endX, y);
            this.ctx.stroke();
        }
        
        // Highlight hovered row
        if (this.pianoRoll.hoveredRow >= 0) {
            this.ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
            this.ctx.fillRect(
                startX,
                this.pianoRoll.hoveredRow * NOTE_HEIGHT,
                endX - startX,
                NOTE_HEIGHT
            );
        }
    }

    /**
     * Draw measure numbers
     */
    drawMeasureNumbers() {
        this.ctx.fillStyle = COLORS.text;
        this.ctx.font = '11px Arial';
        this.ctx.textAlign = 'center';
        
        const startMeasure = Math.floor(this.pianoRoll.scrollX / (GRID_WIDTH * BEATS_PER_MEASURE));
        const endMeasure = Math.ceil((this.pianoRoll.scrollX + this.canvas.width) / 
            (GRID_WIDTH * BEATS_PER_MEASURE));
        
        for (let measure = startMeasure; measure <= endMeasure; measure++) {
            const x = PIANO_KEY_WIDTH + measure * GRID_WIDTH * BEATS_PER_MEASURE;
            this.ctx.fillText((measure + 1).toString(), x + GRID_WIDTH * 2, 12);
        }
    }

    /**
     * Draw loop markers
     */
    drawLoopMarkers() {
        if (!this.pianoRoll.loopEnabled) return;
        
        const loopStartX = PIANO_KEY_WIDTH + this.pianoRoll.loopStart * GRID_WIDTH * BEATS_PER_MEASURE;
        const loopEndX = PIANO_KEY_WIDTH + this.pianoRoll.loopEnd * GRID_WIDTH * BEATS_PER_MEASURE;
        
        // Draw loop background
        this.ctx.fillStyle = COLORS.loopBackground;
        this.ctx.fillRect(
            loopStartX,
            0,
            loopEndX - loopStartX,
            this.pianoRoll.totalHeight
        );
        
        // Draw loop markers
        this.ctx.strokeStyle = COLORS.loopMarker;
        this.ctx.lineWidth = 2;
        
        // Start marker
        this.ctx.beginPath();
        this.ctx.moveTo(loopStartX, 0);
        this.ctx.lineTo(loopStartX, this.pianoRoll.totalHeight);
        this.ctx.stroke();
        
        // End marker
        this.ctx.beginPath();
        this.ctx.moveTo(loopEndX, 0);
        this.ctx.lineTo(loopEndX, this.pianoRoll.totalHeight);
        this.ctx.stroke();
        
        // Draw labels
        this.ctx.fillStyle = COLORS.loopMarker;
        this.ctx.font = 'bold 12px Arial';
        this.ctx.textAlign = 'center';
        this.ctx.fillText('A', loopStartX, 25);
        this.ctx.fillText('B', loopEndX, 25);
    }

    /**
     * Draw all notes
     */
    drawNotes() {
        const startMeasure = Math.floor((this.pianoRoll.scrollX - VISIBLE_AREA_PADDING) / 
            (GRID_WIDTH * BEATS_PER_MEASURE));
        const endMeasure = Math.ceil((this.pianoRoll.scrollX + this.canvas.width + VISIBLE_AREA_PADDING) / 
            (GRID_WIDTH * BEATS_PER_MEASURE));
        
        const visibleNotes = this.pianoRoll.noteManager.getNotesInMeasures(startMeasure, endMeasure);
        
        // Draw notes
        for (const note of visibleNotes) {
            this.drawNote(note);
        }
    }

    /**
     * Draw a single note
     */
    drawNote(note) {
        const isSelected = this.pianoRoll.noteManager.selectedNotes.has(note);
        const isPlaying = this.pianoRoll.playingNotes && this.pianoRoll.playingNotes.has(note);
        
        // Get instrument color
        const instrumentColor = this.pianoRoll.getInstrumentColor(note.instrument);
        
        // Draw note body
        if (isSelected) {
            // Use orange for selected notes
            this.ctx.fillStyle = '#ffa500';
        } else if (isPlaying) {
            this.ctx.fillStyle = instrumentColor.border;
        } else {
            this.ctx.fillStyle = instrumentColor.note;
        }
        
        this.ctx.fillRect(note.x, note.y, note.width, note.height);
        
        // Draw note border
        if (isSelected) {
            this.ctx.strokeStyle = '#ff8800';
            this.ctx.lineWidth = 2;
        } else {
            this.ctx.strokeStyle = instrumentColor.border;
            this.ctx.lineWidth = 1;
        }
        this.ctx.strokeRect(note.x, note.y, note.width, note.height);
        
        // Draw velocity indicator (darker = lower velocity)
        // Skip velocity overlay for selected notes to keep orange color clear
        if (!isSelected) {
            const velocityAlpha = 1 - (note.velocity / 127) * 0.6;
            this.ctx.fillStyle = `rgba(0, 0, 0, ${velocityAlpha})`;
            this.ctx.fillRect(note.x, note.y, note.width, note.height);
        }
        
        // Draw pan indicator if not centered
        if (Math.abs(note.pan) > 5) {
            this.ctx.save();
            this.ctx.font = '8px Arial';
            this.ctx.fillStyle = '#fff';
            this.ctx.textAlign = note.pan < 0 ? 'left' : 'right';
            const panText = note.pan < 0 ? 'L' : 'R';
            const textX = note.pan < 0 ? note.x + 2 : note.x + note.width - 2;
            this.ctx.fillText(panText, textX, note.y + note.height - 2);
            this.ctx.restore();
        }
    }

    /**
     * Draw piano keys
     */
    drawPianoKeys() {
        this.ctx.save();
        this.ctx.translate(0, -this.pianoRoll.scrollY);
        
        // Draw background
        this.ctx.fillStyle = '#2a2a2a';
        this.ctx.fillRect(0, 0, PIANO_KEY_WIDTH, this.pianoRoll.totalHeight);
        
        // Draw keys
        for (let i = 0; i < this.pianoRoll.numKeys; i++) {
            const y = i * NOTE_HEIGHT;
            const keyInOctave = (this.pianoRoll.numKeys - 1 - i) % NOTES_PER_OCTAVE;
            const noteInScale = Math.floor(keyInOctave / 6);
            const microtone = keyInOctave % 6;
            const octave = Math.floor((this.pianoRoll.numKeys - 1 - i) / NOTES_PER_OCTAVE);
            
            // Determine if this is a "black key" equivalent
            const isBlackKey = [1, 3, 6, 8, 10].includes(noteInScale);
            
            // Check if key is pressed
            const keyNumber = this.pianoRoll.numKeys - 1 - i;
            const isPressed = this.pianoRoll.inputHandler?.pressedKeys.has(keyNumber);
            
            // Draw key
            if (isPressed) {
                this.ctx.fillStyle = '#4a9eff';
            } else if (isBlackKey) {
                this.ctx.fillStyle = COLORS.blackKey;
            } else {
                this.ctx.fillStyle = COLORS.whiteKey;
            }
            
            this.ctx.fillRect(0, y, PIANO_KEY_WIDTH - 1, NOTE_HEIGHT);
            
            // Draw key border
            this.ctx.strokeStyle = COLORS.keyBorder;
            this.ctx.strokeRect(0, y, PIANO_KEY_WIDTH - 1, NOTE_HEIGHT);
            
            // Draw note label for C notes and at regular intervals
            if ((noteInScale === 0 && microtone === 0) || (keyInOctave % 12 === 0)) {
                this.ctx.fillStyle = isBlackKey ? '#aaa' : '#fff';
                this.ctx.font = '10px Arial';
                this.ctx.textAlign = 'right';
                
                const noteName = this.noteNames[noteInScale];
                const microLabel = this.microtonalMarkers[microtone];
                const label = `${noteName}${octave}${microLabel}`;
                
                this.ctx.fillText(label, PIANO_KEY_WIDTH - 5, y + NOTE_HEIGHT - 2);
            }
        }
        
        // Draw border
        this.ctx.strokeStyle = '#555';
        this.ctx.lineWidth = 1;
        this.ctx.strokeRect(0, 0, PIANO_KEY_WIDTH, this.pianoRoll.totalHeight);
        
        this.ctx.restore();
    }

    /**
     * Draw selection box
     */
    drawSelectionBox() {
        const box = this.pianoRoll.inputHandler?.selectionBox;
        if (!box) return;
        
        const x = Math.min(box.x1, box.x2);
        const y = Math.min(box.y1, box.y2);
        const width = Math.abs(box.x2 - box.x1);
        const height = Math.abs(box.y2 - box.y1);
        
        // Different colors for delete selection
        const isDelete = this.pianoRoll.inputHandler?.isDeleteSelecting;
        
        this.ctx.fillStyle = isDelete ? 'rgba(255, 100, 100, 0.2)' : 'rgba(100, 150, 255, 0.2)';
        this.ctx.fillRect(x, y, width, height);
        
        this.ctx.strokeStyle = isDelete ? '#ff6666' : '#6696ff';
        this.ctx.lineWidth = 1;
        this.ctx.strokeRect(x, y, width, height);
    }

    /**
     * Draw playhead (measure highlight)
     */
    drawPlayhead() {
        if (!this.pianoRoll.isPlaying && !this.pianoRoll.isPaused) return;
        
        const currentMeasure = this.pianoRoll.currentMeasure;
        if (currentMeasure >= 0 && currentMeasure < this.pianoRoll.totalMeasures) {
            const measureWidth = BEATS_PER_MEASURE * GRID_WIDTH;
            const measureX = PIANO_KEY_WIDTH + currentMeasure * measureWidth;
            
            // Draw measure highlight
            this.ctx.fillStyle = 'rgba(255, 68, 68, 0.1)';
            this.ctx.fillRect(measureX, this.pianoRoll.scrollY, measureWidth, this.canvas.height);
            
            // Draw measure border
            this.ctx.strokeStyle = 'rgba(255, 68, 68, 0.5)';
            this.ctx.lineWidth = 2;
            this.ctx.strokeRect(measureX, this.pianoRoll.scrollY, measureWidth, this.canvas.height);
        }
    }

    /**
     * Draw FPS counter
     */
    drawFPS() {
        this.ctx.save();
        this.ctx.fillStyle = '#fff';
        this.ctx.font = '12px Arial';
        this.ctx.textAlign = 'right';
        this.ctx.fillText(`FPS: ${Math.round(this.fps)}`, this.canvas.width - 10, 20);
        this.ctx.restore();
    }

    /**
     * Update FPS calculation
     */
    updateFPS(now) {
        this.frameCount++;
        
        if (now - this.lastFrameTime >= 1000) {
            this.fps = this.frameCount * 1000 / (now - this.lastFrameTime);
            this.frameCount = 0;
            this.lastFrameTime = now;
        }
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
     * Resize canvas
     */
    resize() {
        const container = this.canvas.parentElement;
        this.canvas.width = container.clientWidth;
        this.canvas.height = container.clientHeight;
    }
}